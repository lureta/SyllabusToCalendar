// ======== CONFIG ========

// Put your real Gemini API key here (do NOT commit it to GitHub)
const GEMINI_API_KEY = "AIzaSyB7zD3OizZb86J0Bpks5BLQ6wicBIeF35Y";

// Latest stable model name
const MODEL_NAME = "gemini-2.5-flash-lite";

// Remember a course title detected by AI
let globalCourseTitle = "";

// ======== SMALL HELPERS FOR DATES ========

const MONTH_MAP = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08", sep: "09", sept: "09",
  oct: "10", nov: "11", dec: "12"
};

function extractNumericDate(text) {
  // 10/09 or 10-9 or 10/09/2025
  const m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\b/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const year = m[3] || null;
  return { mm, dd, year };
}

function extractMonthWordDate(text) {
  const lower = text.toLowerCase();
  const monthRegex =
    /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:,\s*(\d{4}))?/i;
  const m = lower.match(monthRegex);
  if (!m) return null;
  const mm = MONTH_MAP[m[1].toLowerCase()];
  const dd = m[2].padStart(2, "0");
  const year = m[3] || null;
  return { mm, dd, year };
}

function parseDateStringToParts(dateStr) {
  let info = extractNumericDate(dateStr);
  if (!info) info = extractMonthWordDate(dateStr);
  if (!info) return null;
  const year = info.year || String(new Date().getFullYear());
  return { mm: info.mm, dd: info.dd, year };
}

function escapeHTML(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ======== VOICE PARSING ========

// Split one transcript into multiple exam/quiz events
function parseVoiceTranscriptMulti(transcript) {
  const clauses = transcript
    .split(/\b(?:and also|and then|and|also|plus)\b/gi)
    .map(c => c.trim())
    .filter(c => c.length > 0);

  const events = [];
  clauses.forEach((clause) => {
    const ev = parseVoiceClause(clause);
    if (ev) events.push(ev);
  });
  return events;
}

// Parse a single clause into {title, date, original, course}
function parseVoiceClause(text) {
  const originalText = text.trim();
  if (!originalText) return null;

  const lower = originalText.toLowerCase();

  // Date
  let info = extractNumericDate(lower) || extractMonthWordDate(lower);
  if (!info) return null; // if no date, skip
  const mmdd = info.mm + "/" + info.dd;

  // Course – CMSC 330, EDHD 460, etc.
  let course = "";
  const courseMatch = originalText.match(/\b([A-Za-z]{3,4}\s*\d{2,3})\b/);
  if (courseMatch) {
    course = courseMatch[1].replace(/\s+/, " ").toUpperCase();
  } else if (globalCourseTitle) {
    course = globalCourseTitle;
  }

  // What kind of assessment?
  let kind = "Exam";
  if (/\bquiz\b/i.test(lower)) kind = "Quiz";
  if (/\bmid[-\s]?term\b/i.test(lower)) kind = "Midterm";
  if (/\bfinal\b/i.test(lower)) kind = "Final Exam";

  // Optional number: "exam 1", "quiz 2"
  let num = "";
  const numMatch = lower.match(/(?:exam|quiz|test)\s*(\d+)/i);
  if (numMatch) num = numMatch[1];

  let shortTitle = kind;
  if (num) shortTitle += " " + num;

  return {
    title: shortTitle,
    date: mmdd,
    original: originalText,
    course: course
  };
}

// ======== AI PARSERS (TEXT + PDF) ========

async function aiParseSyllabusFromText(text) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    alert("Add your Gemini API key in popup.js first.");
    return [];
  }

  const prompt = `
You will be given a college course syllabus as plain text.

Your job:
1. Detect the course title, like "EDHD460 Educational Psychology".
2. Extract ONLY quizzes, exams, midterms, and finals.

Return a JSON array like:
[
  {
    "title": "Week 1 Reading Quiz",
    "date": "09/02",
    "original": "full original line here",
    "course": "EDHD460 Educational Psychology"
  },
  {
    "title": "Exam I",
    "date": "10/09",
    "original": "...",
    "course": "EDHD460 Educational Psychology"
  }
]

Rules:
- Only include assessments that are quizzes, exams, midterms, or finals.
- Keep dates exactly as written if possible (e.g. "September 12", "10/14", "09/02").
- Include a "course" field in each object with the course title if you can find it.
- Do NOT include explanations or markdown code fences.
- Return ONLY a valid JSON array.

Syllabus text:
${text}
`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL_NAME +
      ":generateContent?key=" +
      GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    }
  );

  if (!res.ok) {
    console.error("Gemini error response", await res.text());
    alert("AI parse failed. Check console for details.");
    return [];
  }

  const data = await res.json();
  return extractEventsFromGeminiResponse(data);
}

async function aiParseSyllabusFromPdf(file) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    alert("Add your Gemini API key in popup.js first.");
    return [];
  }

  const base64Pdf = await fileToBase64(file);

  const prompt = `
You are given a college course syllabus as a PDF document.

Your job:
1. Detect the course title, like "EDHD460 Educational Psychology".
2. Extract ONLY quizzes, exams, midterms, and finals.

Return a JSON array like:
[
  {
    "title": "Week 1 Reading Quiz",
    "date": "09/02",
    "original": "full original line or phrase",
    "course": "EDHD460 Educational Psychology"
  },
  {
    "title": "Exam I",
    "date": "10/09",
    "original": "...",
    "course": "EDHD460 Educational Psychology"
  }
]

Rules:
- Only include assessments that are quizzes, exams, midterms, or finals.
- Keep dates exactly as written if possible.
- Include a "course" field in each object with the course title if you can find it.
- Do NOT include explanations or markdown code fences.
- Return ONLY a valid JSON array.
`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL_NAME +
      ":generateContent?key=" +
      GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64Pdf
                }
              },
              { text: prompt }
            ]
          }
        ]
      })
    }
  );

  if (!res.ok) {
    console.error("Gemini PDF error response", await res.text());
    alert("AI PDF parse failed. Check console for details.");
    return [];
  }

  const data = await res.json();
  return extractEventsFromGeminiResponse(data);
}

// Common helper to pull JSON array out of Gemini response
function extractEventsFromGeminiResponse(data) {
  let textOutput =
    data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

  // Strip any junk around the JSON array
  let jsonText = textOutput.trim();
  const firstBracket = jsonText.indexOf("[");
  const lastBracket = jsonText.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1) {
    jsonText = jsonText.slice(firstBracket, lastBracket + 1);
  }

  let events;
  try {
    events = JSON.parse(jsonText);
  } catch (e) {
    console.error("Error parsing JSON from Gemini:", e, jsonText);
    alert("AI returned something that wasn't valid JSON. Check console.");
    return [];
  }

  globalCourseTitle = "";
  const normalized = events.map((ev) => {
    const course =
      ev.course || ev.class || ev.course_title || ev.courseName || "";
    if (!globalCourseTitle && course) {
      globalCourseTitle = course;
    }
    return {
      title: ev.title || "",
      date: ev.date || "",
      original: ev.original || "",
      course: course || ""
    };
  });

  return normalized;
}

// ======== FILE HELPERS (PDF → base64) ========

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = arrayBufferToBase64(reader.result);
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ======== UI HANDLERS ========

// 1. Text → AI Parse button
document.getElementById("aiParseBtn").addEventListener("click", async () => {
  const text = document.getElementById("syllabus").value.trim();
  if (!text) {
    alert("Paste your syllabus first.");
    return;
  }

  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "<p>Asking AI to parse your syllabus…</p>";

  try {
    const events = await aiParseSyllabusFromText(text);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong with AI parsing. Check console.");
  }
});

// 2. PDF → AI Parse button
document.getElementById("pdfParseBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("pdfInput");
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    alert("Choose a syllabus PDF first.");
    return;
  }

  if (file.type !== "application/pdf") {
    alert("Please choose a PDF file.");
    return;
  }

  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML =
    "<p>Uploading PDF and asking AI to parse your syllabus…</p>";

  try {
    const events = await aiParseSyllabusFromPdf(file);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong parsing the PDF. Check console.");
  }
});

// 3. Voice button → SpeechRecognition
document.getElementById("voiceBtn").addEventListener("click", () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Your browser does not support speech recognition.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const voiceBtn = document.getElementById("voiceBtn");
  const voiceLabel = document.getElementById("voiceBtnLabel");
  const voiceStatus = document.getElementById("voiceStatus");
  const voiceViz = document.getElementById("voiceViz");

  recognition.onstart = () => {
    voiceBtn.classList.add("listening");
    voiceViz.classList.add("listening");
    voiceLabel.textContent = "🎙 Listening…";
    if (voiceStatus) voiceStatus.textContent = "Speak your exams and dates.";
  };

  recognition.onerror = (event) => {
    console.error("Speech error:", event.error);
    alert("Voice error: " + event.error);
  };

  recognition.onend = () => {
    voiceBtn.classList.remove("listening");
    voiceViz.classList.remove("listening");
    voiceLabel.textContent = "🎙 Add exam by voice";
    if (voiceStatus && !voiceStatus.textContent.startsWith("Added")) {
      voiceStatus.textContent = "";
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log("Heard:", transcript);

    const newEvents = parseVoiceTranscriptMulti(transcript);
    if (!newEvents || newEvents.length === 0) {
      alert(
        "I couldn't find any dates in what you said. Try something like 'Exam 1 on October 9 and a quiz on October 11'."
      );
      if (voiceStatus) voiceStatus.textContent = "";
      return;
    }

    // Show ONLY the voice-added events
    renderEvents(newEvents);

    if (voiceStatus) {
      voiceStatus.textContent =
        newEvents.length === 1
          ? "Added 1 exam from your voice."
          : `Added ${newEvents.length} exams/quizzes from your voice.`;
    }
  };

  recognition.start();
});

// ======== RENDER EVENTS + CALENDAR BUTTONS ========

function renderEvents(events) {
  const resultsDiv = document.getElementById("results");

  if (!events || events.length === 0) {
    resultsDiv.innerHTML = "<p>No quizzes or exams found.</p>";
    window.parsedEvents = [];
    return;
  }

  let html = "";

  if (globalCourseTitle) {
    html += `<div class="course-badge">Course detected: ${escapeHTML(
      globalCourseTitle
    )}</div>`;
  }

  html += `
    <table>
      <tr>
        <th>Title</th>
        <th>Date</th>
        <th>Add</th>
      </tr>
  `;

  events.forEach((ev, index) => {
    // Display like "EDHD460 Educational Psychology: Exam 1"
// Extract only the class code, like "EDHD460" or "CMSC330"
function extractClassCode(str) {
  if (!str) return "";
  const m = str.match(/\b([A-Za-z]{3,4}\s*\d{2,3})\b/);
  return m ? m[1].replace(/\s+/, "") : "";
}

    let displayTitle = ev.title || "";

    // Use only the class code, not the full name
    const coursePrefix =
    extractClassCode(ev.course) ||
    extractClassCode(globalCourseTitle) ||
    "";

    // Final formatted title
    if (coursePrefix && displayTitle) {
    displayTitle = `${coursePrefix}: ${displayTitle}`;
    }

    const safeTitle = escapeHTML(displayTitle);
    const safeDate = escapeHTML(ev.date || "");

    html += `
      <tr>
        <td>
          <input type="text"
                 data-index="${index}"
                 data-field="title"
                 value="${safeTitle}" />
        </td>
        <td>
          <input type="text"
                 data-index="${index}"
                 data-field="date"
                 value="${safeDate}" />
        </td>
        <td>
          <button class="addBtn" data-index="${index}">Add</button>
        </td>
      </tr>
    `;
  });

  html += "</table>";
  window.parsedEvents = events;
  resultsDiv.innerHTML = html;

  // Track edits (title/date textboxes)
  resultsDiv.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (evt) => {
      const idx = parseInt(evt.target.getAttribute("data-index"), 10);
      const field = evt.target.getAttribute("data-field");
      window.parsedEvents[idx][field] = evt.target.value;
    });
  });

  // Handle "Add" buttons
  resultsDiv.querySelectorAll(".addBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      const ev = window.parsedEvents[idx];
      addToCalendar(ev);
    });
  });
}

// Open a pre-filled Google Calendar event page for this event.
function addToCalendar(ev) {
  if (!ev || !ev.date) {
    alert("This event is missing a date.");
    return;
  }

  const parts = parseDateStringToParts(ev.date);
  if (!parts) {
    alert("Could not understand the date format: " + ev.date);
    return;
  }

  const year = parts.year;
  const month = parts.mm;
  const day = parts.dd;

  const startDateStr = `${year}${month}${day}`;

  // End date = next day (all-day event range)
  const startDateObj = new Date(`${year}-${month}-${day}T00:00:00`);
  startDateObj.setDate(startDateObj.getDate() + 1);
  const endYear = startDateObj.getFullYear();
  const endMonth = String(startDateObj.getMonth() + 1).padStart(2, "0");
  const endDay = String(startDateObj.getDate()).padStart(2, "0");
  const endDateStr = `${endYear}${endMonth}${endDay}`;

  let course = ev.course || globalCourseTitle || "";
  let title = ev.title || "Class assessment";
  if (course) {
    title = `${course}: ${title}`;
  }

  const params = new URLSearchParams({
    text: title,
    dates: `${startDateStr}/${endDateStr}`,
    details: ev.original || ""
  });

  const url =
    "https://calendar.google.com/calendar/u/0/r/eventedit?" +
    params.toString();

  window.open(url, "_blank");
}
