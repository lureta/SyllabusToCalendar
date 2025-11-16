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

// MORE FORGIVING MONTH PARSER – handles "novemr 4th", "novemberrr 4", etc.
function extractMonthWordDate(text) {
  const lower = text.toLowerCase();

  // 1) Try strict "October 9" / "Oct 9, 2025" with optional st/nd/rd/th
  const monthRegex =
    /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{2,4}))?/i;
  let m = lower.match(monthRegex);
  if (m) {
    const mm = MONTH_MAP[m[1].toLowerCase()];
    const dd = m[2].padStart(2, "0");
    let year = m[3] || null;
    if (year && year.length === 2) {
      year = "20" + year;
    }
    return { mm, dd, year };
  }

  // 2) Loose fallback: any word starting with jan/feb/mar/... then a day with suffix
  const looseMonth = lower.match(/\b(jan\w*|feb\w*|mar\w*|apr\w*|may\w*|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/);
  if (!looseMonth) return null;

  const monthRoot = looseMonth[1].slice(0, 3); // "novemr" -> "nov"
  const mm = MONTH_MAP[monthRoot];
  if (!mm) return null;

  const rest = lower.slice(looseMonth.index + looseMonth[0].length);
  const dayMatch = rest.match(/(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{2,4}))?/);
  if (!dayMatch) return null;

  const dd = dayMatch[1].padStart(2, "0");
  let year = dayMatch[2] || null;
  if (year && year.length === 2) {
    year = "20" + year;
  }

  return { mm, dd, year };
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

// FIXED: more careful time extractor so it ignores "CMSC330" and prefers "at 2 pm"
function extractTimeRange(text) {
  if (!text) return { start: "", end: "" };

  const lower = text.toLowerCase();
  // normalize "2 pm" → "2pm"
  const normalized = lower.replace(/(\d)\s*(am|pm)\b/g, "$1$2");

  // 1) Explicit "at 2 pm"
  let m = normalized.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m) {
    const start = buildTimeString(m[1], m[2], m[3]);
    return { start, end: "" };
  }

  // 2) Time ranges like "2–3 pm" or "2:00 pm - 3:15 pm"
  const rangeRegex =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

  m = normalized.match(rangeRegex);
  if (m) {
    const start = buildTimeString(m[1], m[2], m[3]);
    const end = buildTimeString(m[4], m[5], m[6] || m[3]);
    return { start, end };
  }

  // 3) Fallback: any standalone time, but with word boundaries
  const singleRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
  m = normalized.match(singleRegex);
  if (!m) return { start: "", end: "" };

  const start = buildTimeString(m[1], m[2], m[3]);
  return { start, end: "" };
}

// FIXED: reject impossible times like 33:00 entirely
function parseTimeStringToParts(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = m[3] ? m[3].toLowerCase() : "";

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  // reject impossible hours/minutes
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

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

  // Date – now robust to "novemr 4th", "november 4", "nov 4"
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

  // ensure times always have am/pm for VOICE events
  function ensureAmPm(timeStr) {
    if (!timeStr) return timeStr;
    if (/\b(am|pm)\b/i.test(timeStr)) return timeStr;
    return timeStr + " PM";
  }

  let startTimeStr = start;
  let endTimeStr = end;

  if (!startTimeStr && globalClassStartTimeStr) {
    startTimeStr = globalClassStartTimeStr;
  }
  if (!endTimeStr && globalClassEndTimeStr) {
    endTimeStr = globalClassEndTimeStr;
  }

  startTimeStr = ensureAmPm(startTimeStr);
  endTimeStr = ensureAmPm(endTimeStr);

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

  // Split on common connectors, but each piece still gets scanned for a full exam line
  const segments = fullTranscript.split(/\b(?:and|also|then)\b/i);
  const results = [];

  segments.forEach((seg) => {
    const ev = parseVoiceSegment(seg);
    if (ev) results.push(ev);
  });

  // If splitting fails, try the whole thing as one
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

    // Save the detected "normal" class time the first time we see one
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

// TEXT PARSE
document.getElementById("aiParseBtn").addEventListener("click", async () => {
  const text = document.getElementById("syllabus").value.trim();
  const loading = document.getElementById("aiLoading");
  const resultsDiv = document.getElementById("results");

  if (!text) {
    alert("Paste your syllabus first.");
    return;
  }

  loading.textContent = "AI is reading your syllabus…";
  loading.classList.add("loading");
  resultsDiv.innerHTML = "<p>Asking AI to parse your syllabus…</p>";

  try {
    const events = await aiParseSyllabusFromText(text);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong with AI parsing. Check console.");
  } finally {
    loading.textContent = "";
    loading.classList.remove("loading");
  }
});

// PDF PARSE
document.getElementById("pdfParseBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("pdfInput");
  const file = fileInput.files && fileInput.files[0];
  const loading = document.getElementById("aiLoading");
  const resultsDiv = document.getElementById("results");

  if (!file) {
    alert("Choose a syllabus PDF first.");
    return;
  }
  if (file.type !== "application/pdf") {
    alert("Please choose a PDF file.");
    return;
  }

  loading.textContent = "AI is reading your PDF…";
  loading.classList.add("loading");
  resultsDiv.innerHTML =
    "<p>Uploading PDF and asking AI to parse your syllabus…</p>";

  try {
    const events = await aiParseSyllabusFromPdf(file);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong parsing the PDF. Check console.");
  } finally {
    loading.textContent = "";
    loading.classList.remove("loading");
  }
});

// VOICE PARSE
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
  const loading = document.getElementById("aiLoading");

  recognition.onstart = () => {
    voiceBtn.textContent = "Listening…";
    voiceStatus.textContent = "Say your class, exam name, date, and time.";
  };

  recognition.onerror = (event) => {
    console.error("Speech error:", event.error);
    alert("Voice error: " + event.error);
    voiceBtn.textContent = "AI Parse from voice";
    voiceStatus.textContent = "";
    loading.textContent = "";
    loading.classList.remove("loading");
  };

  recognition.onend = () => {
    voiceBtn.textContent = "AI Parse from voice";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log("Heard:", transcript);

    // now AI-style parsing -> show spinner
    loading.textContent = "AI is parsing your voice input…";
    loading.classList.add("loading");

    try {
      const newEvents = parseVoiceTranscriptIntoEvents(transcript);
      if (!newEvents.length) {
        alert(
          "I could not find a date in what you said. Try: 'CMSC 330 exam 1 on October 9 at 2 pm'."
        );
        voiceStatus.textContent = "";
        return;
      }

      window.parsedEvents = newEvents;
      renderEvents(newEvents);
      voiceStatus.textContent =
        "Added " + newEvents.length + " exam(s) from your voice.";
    } finally {
      loading.textContent = "";
      loading.classList.remove("loading");
    }
  };

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
    html += `<div class="course-badge">Course detected: ${escapeHTML(
      globalCourseTitle
    )}</div>`;
  }

  if (globalClassStartTimeStr) {
    const endDisp = globalClassEndTimeStr ? ` – ${escapeHTML(globalClassEndTimeStr)}` : "";
    html += `<div class="course-badge">Class time: ${escapeHTML(
      globalClassStartTimeStr
    )}${endDisp}</div>`;
  }

  html += `
    <table>
      <tr>
        <th>Title</th>
        <th>Date</th>
        <th>Start</th>
        <th>End</th>
        <th>Add</th>
      </tr>
  `;

  events.forEach((ev, index) => {
    const safeTitle = escapeHTML(ev.title || "");
    const safeDate = escapeHTML(ev.date || "");
    const safeTime = escapeHTML(ev.time || "");
    const safeEnd = escapeHTML(ev.endTime || "");

    html += `
      <tr>
        <td>
          <input type="text"
                 class="title-input"
                 data-index="${index}"
                 data-field="title"
                 value="${safeTitle}" />
        </td>
        <td>
          <input type="text"
                 class="date-input"
                 data-index="${index}"
                 data-field="date"
                 value="${safeDate}" />
        </td>
        <td>
          <input type="text"
                 class="time-input"
                 placeholder="e.g. 2:00 pm"
                 data-index="${index}"
                 data-field="time"
                 value="${safeTime}" />
        </td>
        <td>
          <input type="text"
                 class="end-input"
                 placeholder="e.g. 3:15 pm"
                 data-index="${index}"
                 data-field="endTime"
                 value="${safeEnd}" />
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

  resultsDiv.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (evt) => {
      const idx = parseInt(evt.target.getAttribute("data-index"), 10);
      const field = evt.target.getAttribute("data-field");
      window.parsedEvents[idx][field] = evt.target.value;
    });
  });

  resultsDiv.querySelectorAll(".addBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      const ev = window.parsedEvents[idx];
      addToCalendar(ev);
    });
  });

  // show card + auto scroll + pop glow
  const card  = document.getElementById("resultsCard");
  const shell = document.querySelector(".shell");

  card.style.display = "block";
  card.classList.add("has-content");

  card.classList.remove("pop");
  void card.offsetWidth; // reflow
  card.classList.add("pop");

  const targetTop = card.offsetTop - 16;
  shell.scrollTo({ top: targetTop, behavior: "smooth" });
}

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

  let startStr;
  let endStr;

  const timeParts = ev.time ? parseTimeStringToParts(ev.time) : null;
  const endPartsRaw = ev.endTime
    ? parseTimeStringToParts(ev.endTime)
    : (globalClassEndTimeStr
        ? parseTimeStringToParts(globalClassEndTimeStr)
        : null);

  if (timeParts) {
    const hh = parseInt(timeParts.hh, 10);
    const mm = parseInt(timeParts.min, 10);

    const startDate = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hh,
      mm,
      0
    );

    let endDate;
    if (endPartsRaw) {
      const eh = parseInt(endPartsRaw.hh, 10);
      const em = parseInt(endPartsRaw.min, 10);
      endDate = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        eh,
        em,
        0
      );
      if (endDate <= startDate) {
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      }
    } else {
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    }

    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(
        d.getHours()
      )}${pad(d.getMinutes())}00`;

    startStr = fmt(startDate);
    endStr = fmt(endDate);
  } else {
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

  const title = ev.title || "Class assessment";

  const params = new URLSearchParams({
    text: title,
    dates: `${startStr}/${endStr}`,
    details: ev.original || ""
  });

  const url =
    "https://calendar.google.com/calendar/u/0/r/eventedit?" +
    params.toString();

  window.open(url, "_blank");
}
