document.getElementById("parseBtn").addEventListener("click", () => {
  const text = document.getElementById("syllabus").value;
  const lines = text.split("\n");
  const results = [];

  lines.forEach(line => {
    const lower = line.toLowerCase();
    if (
      lower.includes("quiz") ||
      lower.includes("exam") ||
      lower.includes("midterm") ||
      lower.includes("final")
    ) {
      results.push(line.trim());
    }
  });

  document.getElementById("results").innerHTML =
    results.length === 0
      ? "<p>No exams found.</p>"
      : results.map(item => `<p>${item}</p>`).join("");
});
