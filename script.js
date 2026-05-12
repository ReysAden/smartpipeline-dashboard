const API_URL = "";

const tableBody = document.getElementById("results-body");
const totalFilesEl = document.getElementById("total-files");
const imageCountEl = document.getElementById("image-count");
const documentCountEl = document.getElementById("document-count");
const emptyState = document.querySelector(".empty-state");

// S3 keys come in as "uploads/some-uuid-originalname.jpg" — strip the folder
// prefix and the UUID so we show just the human-readable filename.
function formatFileName(key) {
  const withoutFolder = key.replace("uploads/", "");
  return withoutFolder.replace(/^[0-9a-f-]+-/, "");
}

// The `result` field is a raw string whose format varies by processing service.
// This function normalises it into a typed object so renderDropdown() doesn't
// have to care about parsing details.
function parseResult(file) {
  const result = file.result || "";

  // Textract receipt output uses "|" as a column separator and always starts
  // with "SHOP" as the first header token.
  if (result.startsWith("SHOP |")) {
    const parts = result.split("|").map(s => s.trim());
    // First 4 tokens are column headers; everything after is item data in
    // groups of 3: [article name, amount, tax rate].
    const headers = parts.slice(0, 4);
    const rows = [];
    let i = 4;
    while (i < parts.length) {
      rows.push(parts.slice(i, i + 3));
      i += 3;
    }
    return { type: "textract-receipt", headers, rows, raw: result };
  }

  // PDFs are processed asynchronously by Textract; the result field just
  // carries a status message rather than extracted content.
  if (result.toLowerCase().includes("async")) {
    return { type: "pdf-async", raw: result };
  }

  // Rekognition returns a flat comma-separated list of detected label strings.
  const labels = result.split(",").map(s => s.trim()).filter(Boolean);
  return { type: "rekognition", labels };
}

// Builds the hidden <tr> that slides open beneath a file row.
// Returns a <tr> element (not yet attached to the DOM).
function renderDropdown(file) {
  const parsed = parseResult(file);
  const div = document.createElement("tr");
  div.className = "result-dropdown";
  div.innerHTML = `<td colspan="5"><div class="dropdown-inner"></div></td>`;
  const inner = div.querySelector(".dropdown-inner");

  if (parsed.type === "rekognition") {
    inner.innerHTML = `
      <div class="dropdown-section">
        <div class="dropdown-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          Amazon Rekognition — Detected Labels
        </div>
        <div class="label-chips">
          ${parsed.labels.map(l => `<span class="chip">${l}</span>`).join("")}
        </div>
      </div>
    `;
  } else if (parsed.type === "textract-receipt") {
    // Re-parse from raw here because we need finer control over the item loop
    // than the generic parseResult() rows give us (specifically the "GROSS"
    // sentinel that terminates the item list).
    const parts = file.result.split("|").map(s => s.trim());
    const items = [];
    let i = 4;
    while (i + 2 < parts.length && parts[i] !== "GROSS") {
      items.push({ name: parts[i], amount: parts[i + 1], tax: parts[i + 2] });
      i += 3;
    }
    // Gross total is always the very last token in the string.
    const gross = parts[parts.length - 1];
    inner.innerHTML = `
      <div class="dropdown-section">
        <div class="dropdown-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>
          Amazon Textract — Receipt Data
        </div>
        <table class="result-table">
          <thead>
            <tr><th>Article</th><th>Amount</th><th>Tax</th></tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td>${item.name}</td>
                <td>${item.amount}</td>
                <td><span class="tax-badge">${item.tax}</span></td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr><td colspan="2" class="gross-label">Gross Total</td><td class="gross-value">${gross}</td></tr>
          </tfoot>
        </table>
      </div>
    `;
  } else if (parsed.type === "pdf-async") {
    // pdf arent fully implemented because they need more time to process than other files
    inner.innerHTML = `
      <div class="dropdown-section">
        <div class="dropdown-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          Document Processing
        </div>
        <p class="async-note">${parsed.raw}</p>
      </div>
    `;
  }

  return div;
}

// Returns a [row, dropdown] pair. They must be inserted consecutively into the
// table so the click handler can reliably reach the dropdown via nextElementSibling.
function renderRow(file) {
  const row = document.createElement("tr");
  row.className = "file-row";
  row.innerHTML = `
    <td>
      ${file.file_type === "image"
        ? `<img src="https://${file.bucket}.s3.amazonaws.com/${file.file_id}" class="preview-image">`
        : `<div class="preview-placeholder">—</div>`
      }
    </td>
    <td class="file-name">${formatFileName(file.file_id)}</td>
    <td class="file-service">
      ${file.file_type === "image"
        ? `<span class="service-badge rekognition">Rekognition</span>`
        : `<span class="service-badge textract">Textract</span>`
      }
    </td>
    <td><span class="status">Complete</span></td>
    <td class="file-date">${new Date(file.processed_at).toLocaleString()}</td>
    <td class="chevron-cell">
      <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </td>
  `;

  const dropdown = renderDropdown(file);
  dropdown.style.display = "none";

  row.addEventListener("click", () => {
    const isOpen = row.classList.contains("open");

    // Collapse any other expanded row before opening this one,
    // so only one dropdown is visible at a time.
    document.querySelectorAll(".file-row.open").forEach(r => {
      r.classList.remove("open");
      r.nextElementSibling.style.display = "none";
    });

    if (!isOpen) {
      row.classList.add("open");
      dropdown.style.display = "";
    }
  });

  return [row, dropdown];
}

function updateCounts(files) {
  const images = files.filter(f => f.file_type === "image").length;
  const documents = files.filter(f => f.file_type !== "image").length;
  totalFilesEl.textContent = files.length;
  imageCountEl.textContent = images;
  documentCountEl.textContent = documents;
}

async function loadFiles() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const files = await response.json();

    tableBody.innerHTML = "";

    if (files.length === 0) {
      emptyState.classList.add("visible");
      return;
    }

    emptyState.classList.remove("visible");
    files.forEach(file => {
      const [row, dropdown] = renderRow(file);
      // Row and dropdown must stay adjacent — the click handler uses
      // nextElementSibling to toggle the dropdown without storing a reference.
      tableBody.appendChild(row);
      tableBody.appendChild(dropdown);
    });
    updateCounts(files);

  } catch (error) {
    console.error("Error loading files:", error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding: 24px; color: #e05c5c;">
          Failed to load files. Please try again.
        </td>
      </tr>
    `;
  }
}

loadFiles();