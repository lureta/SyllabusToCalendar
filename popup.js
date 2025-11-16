// ======== CONFIG ========

// Put your real Gemini API key here (do NOT commit it to GitHub)
const GEMINI_API_KEY = "AIzaSyB7zD3OizZb86J0Bpks5BLQ6wicBIeF35Y";

// Latest stable model name
const MODEL_NAME = "gemini-2.5-flash-lite";

// Remember a course title detected by AI
let globalCourseTitle = "";

// If we can infer the normal class meeting time from the syllabus
let globalClassStartTimeStr = "";
let globalClassEndTimeStr = "";

// All events currently shown in the table
window.parsedEvents = [];

// ======== SMALL HELPERS ========

// Extract class code like "EDHD460" or "CMSC330" from a string
function extractClassCode(str) {
  if (!str) return "";
  const m = str.match(/\b([A-Za-z]{3,4})\s*0?(\d{2,3})\b/);
  if (!m) return "";
  return `${m[1].toUpperCase()}${m[2]}`;
}

const MONTH_MAP = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08", sep: "09", sept: "09",
  oct: "10", nov: "11", dec: "12"
};

function extractNumericDate(text) {
  const m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  let year = m[3] || null;
  if (year && year.length === 2) {
    year = "20" + year;
  }
  return { mm, dd, year };
}

function extractMonthWordDate(text) {
  const lower = text.toLowerCase();

  const monthWords =
    "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

  // 🟪 FORMAT 1: "October 14", "Oct 14th", "October 14 2025"
  let m = lower.match(
    new RegExp(`${monthWords}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(\\d{4})?`)
  );
  if (m) {
    const mm = MONTH_MAP[m[1].substring(0, 3)];
    const dd = m[2].padStart(2, "0");
    let year = m[3] || String(new Date().getFullYear());
    return { mm, dd, year };
  }

  // 🟪 FORMAT 2: "14 October", "14 Oct", "14 October 2025"
  m = lower.match(
    new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthWords}\\s*(\\d{4})?`)
  );
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = MONTH_MAP[m[2].substring(0, 3)];
    let year = m[3] || String(new Date().getFullYear());
    return { mm, dd, year };
  }

  // 🟪 FORMAT 3: "Fri 7 Nov"
  m = lower.match(
    new RegExp(
      `(?:mon|tue|tues|wed|thu|thur|fri|sat|sun)\\s+(\\d{1,2})\\s+${monthWords}\\s*(\\d{4})?`
    )
  );
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = MONTH_MAP[m[2].substring(0, 3)];
    let year = m[3] || String(new Date().getFullYear());
    return { mm, dd, year };
  }

  return null;
}




function parseDateStringToParts(dateStr) {
  let info = extractNumericDate(dateStr);
  if (!info) info = extractMonthWordDate(dateStr);
  if (!info) return null;
  const year = info.year || String(new Date().getFullYear());
  return { mm: info.mm, dd: info.dd, year };
}

// --- Time helpers ---

function buildTimeString(hourStr, minuteStr, ampm) {
  const hh = hourStr;
  const mm = minuteStr || "00";
  if (ampm) {
    return `${hh}:${mm} ${ampm.toUpperCase()}`;
  }
  return `${hh}:${mm}`;
}

function extractTimeRange(text) {
  if (!text) return { start: "", end: "" };

  const lower = text.toLowerCase();

  // ---- 1. Remove date numbers so they don't get mistaken for time ----
  let sanitized = lower
    .replace(/\b\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, "")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{1,2}\b/g, "")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "");

  // ---- 2. Look for patterns: "at 2 pm", "at 14:30", "2pm", "2:30pm" ----
  const timeRegex = /\bat\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  let m = sanitized.match(timeRegex);

  if (!m) {
    m = sanitized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  }

  if (!m) return { start: "", end: "" };

  let hour = parseInt(m[1], 10);
  let minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3] ? m[3].toLowerCase() : "";

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");

  return {
    start: `${hh}:${min}`,
    end: ""  // your previous behavior
  };
}


function parseTimeStringToParts(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = m[3] ? m[3].toLowerCase() : "";

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  return {
    hh: String(hour).padStart(2, "0"),
    min: String(minute).padStart(2, "0")
  };
}

function escapeHTML(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ========= VOICE HELPERS =========

function parseVoiceSegment(segment) {
  if (!segment || !segment.trim()) return null;

  let info = extractNumericDate(segment);
  if (!info) info = extractMonthWordDate(segment);
  if (!info) return null;
  const date = `${info.mm}/${info.dd}`;

  const lower = segment.toLowerCase();
  let label = "Exam";
  let num = "";

  const m = lower.match(/\b(quiz|exam|test|midterm|final)\s*(\d+)?/);
  if (m) {
    const kind = m[1];
    if (kind === "quiz") label = "Quiz";
    else if (kind === "midterm") label = "Midterm";
    else if (kind === "final") label = "Final Exam";
    else label = "Exam";
    if (m[2]) num = " " + m[2];
  } else if (lower.includes("quiz")) label = "Quiz";
  else if (lower.includes("midterm")) label = "Midterm";
  else if (lower.includes("final")) label = "Final Exam";

  let baseTitle = label + num;

  const classCode =
    extractClassCode(segment) || extractClassCode(globalCourseTitle);
  const finalTitle = classCode ? `${classCode}: ${baseTitle}` : baseTitle;

  const { start, end } = extractTimeRange(segment);

  let startTimeStr = start;
  let endTimeStr = end;

  if (!startTimeStr && globalClassStartTimeStr) {
    startTimeStr = globalClassStartTimeStr;
  }
  if (!endTimeStr && globalClassEndTimeStr) {
    endTimeStr = globalClassEndTimeStr;
  }

  return {
    title: finalTitle,
    date,
    time: startTimeStr,
    endTime: endTimeStr,
    original: segment,
    course: classCode || ""
  };
}

function parseVoiceTranscriptIntoEvents(fullTranscript) {
  if (!fullTranscript) return [];

  const segments = fullTranscript.split(/\b(?:and|also|then)\b/i);
  const results = [];

  segments.forEach((seg) => {
    const ev = parseVoiceSegment(seg);
    if (ev) results.push(ev);
  });

  if (results.length === 0) {
    const ev = parseVoiceSegment(fullTranscript);
    if (ev) results.push(ev);
  }

  return results;
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
2. Detect the usual class meeting time range, like "11:00 am–12:15 pm".
3. Extract ONLY quizzes, exams, midterms, and finals.

Return a JSON array like:
[
  {
    "title": "Week 1 Reading Quiz",
    "date": "09/02",
    "time": "11:00 am",
    "end_time": "12:15 pm",
    "original": "full original line here",
    "course": "EDHD460 Educational Psychology"
  }
]

Rules:
- Only include assessments that are quizzes, exams, midterms, or finals.
- Keep dates exactly as written if possible.
- Use 12-hour times with "am" or "pm" when appropriate.
- If an exam does not list its own time, use the normal class meeting time for "time" and "end_time".
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
        contents: [{ parts: [{ text: prompt + "\n\nSyllabus text:\n" + text }] }]
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
2. Detect the usual class meeting time range, like "11:00 am–12:15 pm".
3. Extract ONLY quizzes, exams, midterms, and finals.

Return a JSON array like:
[
  {
    "title": "Week 1 Reading Quiz",
    "date": "09/02",
    "time": "11:00 am",
    "end_time": "12:15 pm",
    "original": "full original line or phrase",
    "course": "EDHD460 Educational Psychology"
  }
]

Rules:
- Only include assessments that are quizzes, exams, midterms, or finals.
- Keep dates exactly as written if possible.
- Use 12-hour times with "am" or "pm" when appropriate.
- If an exam does not list its own time, use the normal class meeting time for "time" and "end_time".
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

// ======== NORMALIZERS FOR GEMINI RESPONSE ========

function guessDateFromObject(ev) {
  const dateLike = (val) => {
    if (typeof val !== "string") return false;
    return !!(extractNumericDate(val) || extractMonthWordDate(val));
  };

  const dateKeys = ["date", "when", "due", "deadline", "exam_date", "quiz_date"];
  for (const k of dateKeys) {
    if (ev[k] && dateLike(ev[k])) return ev[k];
  }

  for (const [k, v] of Object.entries(ev)) {
    if (k.toLowerCase() === "course" || k.toLowerCase() === "original") continue;
    if (dateLike(v)) return v;
  }
  return "";
}

function guessTitleFromObject(ev, usedDateValue) {
  const titleKeys = ["title", "name", "assessment", "assignment", "quiz", "exam", "label"];
  for (const k of titleKeys) {
    if (ev[k] && typeof ev[k] === "string" && ev[k] !== usedDateValue) {
      return ev[k];
    }
  }

  for (const [k, v] of Object.entries(ev)) {
    if (typeof v !== "string") continue;
    if (v === usedDateValue) continue;
    if (k.toLowerCase() === "course" || k.toLowerCase() === "original") continue;
    return v;
  }

  return "";
}

function guessTimeFromObject(ev) {
  const check = (val) => {
    if (typeof val !== "string") return "";
    const r = extractTimeRange(val);
    return r.start || "";
  };

  const keys = ["time", "start_time", "startTime", "class_time_start"];
  for (const k of keys) {
    if (ev[k]) {
      const t = check(ev[k]);
      if (t) return t;
    }
  }

  for (const [k, v] of Object.entries(ev)) {
    const t = check(v);
    if (t) return t;
  }

  return "";
}

function guessEndTimeFromObject(ev) {
  const check = (val) => {
    if (typeof val !== "string") return "";
    const r = extractTimeRange(val);
    return r.end || r.start || "";
  };

  const keys = ["end_time", "endTime", "class_time_end"];
  for (const k of keys) {
    if (ev[k]) {
      const t = check(ev[k]);
      if (t) return t;
    }
  }

  for (const [k, v] of Object.entries(ev)) {
    const t = check(v);
    if (t) return t;
  }

  return "";
}

function extractEventsFromGeminiResponse(data) {
  let rawText = "[]";
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (p.text) {
      rawText = p.text;
      break;
    }
  }

  let jsonText = rawText.trim();
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

  if (!Array.isArray(events)) {
    console.error("Gemini JSON is not an array:", events);
    return [];
  }

  globalCourseTitle = "";
  globalClassStartTimeStr = "";
  globalClassEndTimeStr = "";

  const normalized = events.map((ev) => {
    if (typeof ev === "string") {
      const dateGuess = guessDateFromObject({ text: ev }) || ev;
      const timeGuessRange = extractTimeRange(ev);
      const timeGuess = timeGuessRange.start;
      const endGuess = timeGuessRange.end;
      const titleGuess = ev.replace(dateGuess, "").trim() || ev;
      return {
        title: titleGuess,
        date: dateGuess,
        time: timeGuess,
        endTime: endGuess,
        original: ev,
        course: ""
      };
    }

    if (typeof ev !== "object" || ev === null) {
      return {
        title: "",
        date: "",
        time: "",
        endTime: "",
        original: String(ev),
        course: ""
      };
    }

    const rawCourse =
      ev.course || ev.class || ev.course_title || ev.courseName || ev.course_code || "";

    if (!globalCourseTitle && rawCourse) globalCourseTitle = rawCourse;

    const dateValue = guessDateFromObject(ev);
    const timeValue = guessTimeFromObject(ev);
    const endTimeValue = guessEndTimeFromObject(ev);
    let baseTitle = guessTitleFromObject(ev, dateValue);

    if (!globalClassStartTimeStr && timeValue) {
      globalClassStartTimeStr = timeValue;
    }
    if (!globalClassEndTimeStr && endTimeValue) {
      globalClassEndTimeStr = endTimeValue;
    }

    const classCode = extractClassCode(rawCourse);
    const finalTitle =
      classCode && baseTitle ? `${classCode}: ${baseTitle}` : baseTitle;

    const original =
      ev.original || ev.line || ev.text || JSON.stringify(ev);

    return {
      title: finalTitle || "",
      date: dateValue || "",
      time: timeValue || "",
      endTime: endTimeValue || "",
      original,
      course: rawCourse || ""
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

document.addEventListener("click", (evt) => {
  if (evt.target && evt.target.id === "openGoogleImport") {
    window.open("https://calendar.google.com/calendar/u/0/r/settings/export");
  }
});


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
  const voiceStatus = document.getElementById("voiceStatus");

  recognition.onstart = () => {
    voiceBtn.textContent = "Listening…";
    voiceStatus.textContent = "Say your class, exam name, date, and time.";
  };

  recognition.onerror = (event) => {
    console.error("Speech error:", event.error);
    alert("Voice error: " + event.error);
    voiceBtn.textContent = "AI Parse from voice";
    voiceStatus.textContent = "";
  };

  recognition.onend = () => {
    voiceBtn.textContent = "AI Parse from voice";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log("Heard:", transcript);

    const newEvents = parseVoiceTranscriptIntoEvents(transcript);
    if (!newEvents.length) {
      alert(
        "I couldn't find a date in what you said. Try something like 'CMSC 330 exam 1 on October 9 at 2 pm'."
      );
      voiceStatus.textContent = "";
      return;
    }

    // Overwrite: show only what was just parsed from voice
    window.parsedEvents = newEvents;
    renderEvents(newEvents);
    voiceStatus.textContent =
      "Added " + newEvents.length + " exam(s) from your voice.";
  }

  recognition.start();
});

// ======== RENDER EVENTS + CALENDAR BUTTONS ========

function renderEvents(events) {
  const resultsDiv = document.getElementById("results");

  if (!events || events.length === 0) {
    resultsDiv.innerHTML = "<p>No quizzes or exams found yet.</p>";
    window.parsedEvents = [];
    return;
  }

  let html = "";

  if (globalCourseTitle) {
    html += `<div class="course-badge">Course detected: ${escapeHTML(globalCourseTitle)}</div>`;
  }

  html += `
    <table>
      <tr>
        <th>Title</th>
        <th>Date</th>
        <th>Time</th>
        <th>Add</th>
      </tr>
  `;

  events.forEach((ev, index) => {
    const safeTitle = escapeHTML(ev.title || "");
    const safeDate = escapeHTML(ev.date || "");
    const safeTime = escapeHTML(ev.time || "");

    html += `
      <tr>
        <td>
          <input type="text"
                 data-index="${index}"
                 data-field="title"
                 value="${safeTitle}">
        </td>
        <td>
          <input type="text"
                 data-index="${index}"
                 data-field="date"
                 value="${safeDate}">
        </td>
        <td>
          <input type="text"
                 data-index="${index}"
                 data-field="time"
                 value="${safeTime}">
        </td>
        <td>
          <button class="addBtn" data-index="${index}">Add</button>
        </td>
      </tr>
    `;
  });

  html += `</table>`;

  window.parsedEvents = events;
  resultsDiv.innerHTML = html;

  // Make the inputs editable
  resultsDiv.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (evt) => {
      const idx = parseInt(evt.target.dataset.index);
      const field = evt.target.dataset.field;
      window.parsedEvents[idx][field] = evt.target.value;
    });
  });

  // Add-to-calendar button
  resultsDiv.querySelectorAll(".addBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index);
      addToCalendar(window.parsedEvents[idx]);
    });
  });
}


// Handle global "Add ALL to Calendar" button
document.addEventListener("click", (event) => {
  if (event.target && event.target.id === "addAllBtn") {
    addAllEventsToCalendar();
  }
});


function addToCalendar(ev) {
  if (!ev || !ev.date) {
    alert("This event is missing a date.");
    return;
  }

  // Build calendar title with course included
  let calendarTitle = ev.title || "Class assessment";
  if (ev.course && ev.course.trim() !== "") {
    calendarTitle = `${ev.course} — ${calendarTitle}`;
  }

  const parts = parseDateStringToParts(ev.date);
  if (!parts) {
    alert("Could not understand the date format: " + ev.date);
    return;
  }

  const year = parts.year;
  const month = parts.mm;
  const day = parts.dd;

  const timeParts = ev.time ? parseTimeStringToParts(ev.time) : null;

  let startStr, endStr;

  if (timeParts) {
    const hh = timeParts.hh;
    const mm = timeParts.min;

    const startDate = new Date(year, month - 1, day, hh, mm, 0);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, "0");

    const fmt = (d) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(
        d.getHours()
      )}${pad(d.getMinutes())}00`;

    startStr = fmt(startDate);
    endStr = fmt(endDate);
  } else {
    // All-day fallback
    const startDateStr = `${year}${month}${day}`;
    const startDateObj = new Date(`${year}-${month}-${day}T00:00:00`);
    startDateObj.setDate(startDateObj.getDate() + 1);
    const endYear = startDateObj.getFullYear();
    const endMonth = String(startDateObj.getMonth() + 1).padStart(2, "0");
    const endDay = String(startDateObj.getDate()).padStart(2, "0");
    const endDateStr = `${endYear}${endMonth}${endDay}`;
    startStr = startDateStr;
    endStr = endDateStr;
  }

  const params = new URLSearchParams({
    text: calendarTitle,
    dates: `${startStr}/${endStr}`,
    details: ev.original || ""
  });

  const url =
    "https://calendar.google.com/calendar/u/0/r/eventedit?" +
    params.toString();

  window.open(url, "_blank");
}

document.addEventListener("click", (event) => {
  if (event.target && event.target.id === "downloadICSBtn") {
    downloadICSFile();
  }
});



// =====================
// EXAMPLE SYLLABUS LOADER
// =====================
document.addEventListener("DOMContentLoaded", () => {
  const exampleBtn = document.getElementById("exampleBtn");
  const syllabusBox = document.getElementById("syllabus");

  if (exampleBtn && syllabusBox) {
    exampleBtn.addEventListener("click", () => {
      syllabusBox.value =
`CMSC 330 — Organization of Programming Languages
Fall 2024 — University of Maryland

Weekly schedule:
Week 3 — Quiz 1 on 09/12
Week 5 — Midterm Exam (closed notes) — around 14 Oct
Week 9 — Quiz 2 — 10/24
Last withdraw date: Fri 7 Nov 430pm
Final Exam (closed book) — Tue 16 Dec 2–5pm

Class meets Tue/Thu 2:00pm–3:15pm in IRB 0318.
`;
    });
  }
});


// =====================
// EXAMPLE + CLEAR BUTTON LOGIC
// =====================
document.addEventListener("DOMContentLoaded", () => {

  const exampleBtn = document.getElementById("exampleBtn");
  const clearBtn = document.getElementById("clearBtn");
  const syllabusBox = document.getElementById("syllabus");

  if (exampleBtn) {
    exampleBtn.addEventListener("click", () => {
      syllabusBox.value =
`CMSC 330 — Organization of Programming Languages
Fall 2024 — University of Maryland

Weekly schedule:
Week 3 — Quiz 1 on 09/12
Week 5 — Midterm Exam (closed notes) — around 14 Oct
Week 9 — Quiz 2 — 10/24
Last withdraw date: Fri 7 Nov 430pm
Final Exam (closed book) — Tue 16 Dec 2–5pm

Class meets Tue/Thu 2:00pm–3:15pm in IRB 0318.
`;
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      syllabusBox.value = "";
    });
  }
});







function extractTimeString(text) {
  if (!text) return "";

  // 430pm, 4:30pm, 2pm, 14:30
  const timeRegex =
    /(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?/i;

  const m = text.match(timeRegex);
  if (!m) return "";

  let hour = parseInt(m[1], 10);
  let minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3] ? m[3].toLowerCase() : "";

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addAllEventsToCalendar() {
  if (!window.parsedEvents || window.parsedEvents.length === 0) {
    alert("No events to add.");
    return;
  }

  // Create events synchronously so Chrome treats them as user-initiated.
  for (let i = 0; i < window.parsedEvents.length; i++) {
    const ev = window.parsedEvents[i];
    addToCalendar(ev); // no delay, opens immediately
  }
}

function generateICS(events) {
  let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nCALSCALE:GREGORIAN\n";

  events.forEach((ev) => {
    const parts = parseDateStringToParts(ev.date);
    if (!parts) return;

    const year = parts.year;
    const month = parts.mm;
    const day = parts.dd;

    const timeParts = ev.time ? parseTimeStringToParts(ev.time) : null;

    let startStr, endStr;

    if (timeParts) {
      const hh = timeParts.hh;
      const mm = timeParts.min;

      const startDate = new Date(year, month - 1, day, hh, mm, 0);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      const pad = (n) => String(n).padStart(2, "0");
      const fmt = (d) =>
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
          d.getDate()
        )}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

      startStr = fmt(startDate);
      endStr = fmt(endDate);
    } else {
      // All-day fallback
      startStr = `${year}${month}${day}`;
      endStr = startStr;
    }

    // Build title
    let calendarTitle = ev.title || "Class assessment";
    if (ev.course && ev.course.trim() !== "") {
      calendarTitle = `${ev.course} — ${calendarTitle}`;
    }

    ics +=
      "BEGIN:VEVENT\n" +
      `SUMMARY:${calendarTitle}\n` +
      `DTSTART:${startStr}\n` +
      `DTEND:${endStr}\n` +
      `DESCRIPTION:${ev.original || ""}\n` +
      "END:VEVENT\n";
  });

  ics += "END:VCALENDAR";
  return ics;
}

function downloadICSFile() {
  if (!window.parsedEvents || window.parsedEvents.length === 0) {
    alert("No events to export.");
    return;
  }

  const icsContent = generateICS(window.parsedEvents);
  const blob = new Blob([icsContent], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);

  // Download ICS (Apple Calendar may auto-open)
  const a = document.createElement("a");
  a.href = url;
  a.download = "exams_schedule.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Inject SECOND BUTTON to open Google Calendar import page
  const results = document.getElementById("results");

  // Remove previous button if already injected
  const oldBtn = document.getElementById("openGoogleImport");
  if (oldBtn) oldBtn.remove();

  results.insertAdjacentHTML(
    "beforeend",
    `
      <button id="openGoogleImport"
        style="
          margin-top: 15px;
          background: #4285F4;
          color: white;
          padding: 10px 18px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          width: 100%;
        ">
        Open Google Calendar Import Page
      </button>
    `
  );
}







