const fileInput = document.getElementById("file-input");
const uploadStatus = document.getElementById("upload-status");

const UPLOAD_API =
  "";

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  uploadStatus.textContent = "Preparing upload...";

  try {
    // Step 1: Ask the backend for a presigned S3 URL.
    // Files go straight from the browser to S3 rather than through the API,
    // so large uploads don't hit Lambda's payload size limit.
    // Fall back to "application/octet-stream" for files with no detectable MIME type.
    const response = await fetch(
      `${UPLOAD_API}?fileName=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type || "application/octet-stream")}`
    );

    if (!response.ok) throw new Error("Failed to get upload URL");

    const data = await response.json();

    // Step 2: PUT the file directly to S3 using the short-lived presigned URL.
    const uploadResponse = await fetch(data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);

    uploadStatus.textContent = "Upload complete.";
    console.log("Uploaded file key:", data.key);

  } catch (error) {
    console.error(error);
    uploadStatus.textContent = "Upload failed.";
  }
});