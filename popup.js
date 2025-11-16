// ======== CONFIG ========

// TODO: put your real Gemini API key here (do NOT share it!)
const GEMINI_API_KEY = "AIzaSyB7zD3OizZb86J0Bpks5BLQ6wicBIeF35Y";

// Latest stable model name
const MODEL_NAME = "gemini-2.5-flash-lite";

// ======== SIMPLE HELPERS ========

// Try to extract a date from a line of text.
function extractDate(line) {
  const monthNames =
    "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)";
  const monthDayRegex = new RegExp(`${monthNames}\\s+\\d{1,2}`, "i");
  const numericRegex = /\b\d{1,2}[\/\-]\d{1,2}\b/;

  const m1 = line.match(monthDayRegex);
  if (m1) return m1[0];

  const m2 = line.match(numericRegex);
  if (m2) return m2[0];

  return "";
}

// Try to guess a clean title from the line by removing the date.
function guessTitle(line) {
  const date = extractDate(line);
  let title = line;
  if (date) title = line.replace(date, "");
  return title.trim().replace(/[-–—]+$/, "").trim();
}

// ======== QUICK (REGEX) PARSER ========

document.getElementById("parseBtn").addEventListener("click", () => {
  const text = document.getElementById("syllabus").value;
  const lines = text.split("\n");
  const events = [];

  lines.forEach((line) => {
    const lower = line.toLowerCase();

    if (
      lower.includes("quiz") ||
      lower.includes("exam") ||
      lower.includes("midterm") ||
      lower.includes("final")
    ) {
      const cleanLine = line.trim();
      events.push({
        original: cleanLine,
        title: guessTitle(cleanLine),
        date: extractDate(cleanLine)
      });
    }
  });

  renderEvents(events);
});

// ======== AI PARSER (GEMINI) ========

async function aiParseSyllabus(text) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    alert("Add your Gemini API key in popup.js first.");
    return [];
  }

  const prompt = `
You will be given a college course syllabus.

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
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  if (!res.ok) {
    console.error("Gemini error response", await res.text());
    alert("AI parse failed. Check console for details.");
    return [];
  }

  const data = await res.json();
  let textOutput =
    data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

  // Strip markdown code fences or extra text around the JSON.
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

  // Normalize objects
  return events.map((ev) => ({
    title: ev.title || "",
    date: ev.date || "",
    original: ev.original || ""
  }));
}

document.getElementById("aiParseBtn").addEventListener("click", async () => {
  const text = document.getElementById("syllabus").value.trim();
  if (!text) {
    alert("Paste your syllabus first.");
    return;
  }

  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "<p>Asking AI to parse your syllabus…</p>";
  document.getElementById("logEventsBtn").style.display = "none";

  try {
    const events = await aiParseSyllabus(text);
    renderEvents(events);
  } catch (err) {
    console.error(err);
    alert("Something went wrong with AI parsing. Check console.");
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
