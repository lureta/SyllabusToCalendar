// ======== CONFIG ========

// Put your real Gemini API key here (do NOT commit it to GitHub)
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";

// Latest stable model name
const MODEL_NAME = "gemini-2.5-flash-lite";

// ======== AI PARSERS (TEXT + PDF) ========

async function aiParseSyllabusFromText(text) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    alert("Add your Gemini API key in popup.js first.");
    return [];
  }

  const prompt = `
You will be given a college course syllabus as plain text.

Extract ONLY quizzes, exams, midterms, and finals as JSON.

Return an array like:
[
  {"title": "Quiz 1", "date": "September 12", "original": "full original line here"},
  {"title": "Midterm Exam", "date": "10/14", "original": "..."}
]

Rules:
- Only include assessments that are quizzes, exams, midterms, or finals.
- Keep dates exactly as written (e.g. "September 12", "10/14", "09/02").
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

Read the PDF and extract ONLY quizzes, exams, midterms, and finals as JSON.

Return an array like:
[
  {"title": "Quiz 1", "date": "September 12", "original": "full original line or phrase"},
  {"title": "Midterm Exam", "date": "10/14", "original": "full original line"}
]

Rules:
- Only include assessments that are quizzes, exams, midterms, or finals.
- Keep dates exactly as written (e.g. "September 12", "10/14", "09/02").
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

  return events.map((ev) => ({
    title: ev.title || "",
    date: ev.date || "",
    original: ev.original || ""
  }));
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

// Text → AI Parse button
document.getElementById("aiParseBtn").addEventListener("click", async () => {
  const text = document.getElementById("syllabus").value.trim();
  if (!text) {
    alert("Paste your syllabus first, or upload a PDF.");
    return;
  }

  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "<p>Asking AI to parse your syllabus…</p>";
  document.getElementById("logEventsBtn").style.display = "none";

  try {
    const events = await aiParseSyllabusFromText(text);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong with AI parsing. Check console.");
  }
});

// PDF upload → AI parse
document.getElementById("pdfInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    alert("Please choose a PDF file.");
    e.target.value = "";
    return;
  }

  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML =
    "<p>Uploading PDF and asking AI to parse your syllabus…</p>";
  document.getElementById("logEventsBtn").style.display = "none";

  try {
    const events = await aiParseSyllabusFromPdf(file);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong parsing the PDF. Check console.");
  }
});

// ======== RENDER EVENTS + CALENDAR BUTTONS ========

function renderEvents(events) {
  const resultsDiv = document.getElementById("results");

  if (!events || events.length === 0) {
    resultsDiv.innerHTML = "<p>No quizzes or exams found.</p>";
    document.getElementById("logEventsBtn").style.display = "none";
    window.parsedEvents = [];
    return;
  }

  let html = `
    <table>
      <tr>
        <th>Title</th>
        <th>Date</th>
        <th>Add</th>
      </tr>
  `;

  events.forEach((ev, index) => {
    const safeTitle = (ev.title || "").replace(/"/g, "&quot;");
    const safeDate = (ev.date || "").replace(/"/g, "&quot;");

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
  document.getElementById("logEventsBtn").style.display = "block";

  // Track edits
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

  const yearInput = document.getElementById("yearInput");
  const year =
    (yearInput && yearInput.value.trim()) ||
    String(new Date().getFullYear());

  // Expect formats like "09/02" or "9-2"
  const parts = ev.date.split(/[\/\-]/);
  if (parts.length < 2) {
    alert("Could not understand the date format: " + ev.date);
    return;
  }

  const month = parts[0].padStart(2, "0");
  const day = parts[1].padStart(2, "0");

  const startDateStr = `${year}${month}${day}`;

  // End date = next day (all-day event range)
  const startDateObj = new Date(`${year}-${month}-${day}T00:00:00`);
  startDateObj.setDate(startDateObj.getDate() + 1);
  const endYear = startDateObj.getFullYear();
  const endMonth = String(startDateObj.getMonth() + 1).padStart(2, "0");
  const endDay = String(startDateObj.getDate()).padStart(2, "0");
  const endDateStr = `${endYear}${endMonth}${endDay}`;

  const params = new URLSearchParams({
    text: ev.title || "Class assessment",
    dates: `${startDateStr}/${endDateStr}`,
    details: ev.original || ""
  });

  const url =
    "https://calendar.google.com/calendar/u/0/r/eventedit?" +
    params.toString();

  window.open(url, "_blank");
}

// Debug helper
document
  .getElementById("logEventsBtn")
  .addEventListener("click", () => {
    console.log("Parsed events:", window.parsedEvents || []);
    alert(
      "Parsed events logged to console.\nRight-click inside the popup → Inspect → Console to see them."
    );
  });
