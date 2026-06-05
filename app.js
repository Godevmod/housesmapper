const DB_NAME = "houses-mappe";
const DB_VERSION = 1;
const STORE = "records";
const PHOTO_MAX_SIZE = 1600;
const PHOTO_QUALITY = 0.78;
const PROJECT_ID_KEY = "houses-mappe-project-id";

const state = {
  records: [],
  projectId: new URLSearchParams(location.search).get("project") || localStorage.getItem(PROJECT_ID_KEY) || "",
  filter: "all",
  addressQuery: "",
  commentQuery: "",
  dateQuery: "",
  comments: [],
  photos: [],
  viewerPhotos: [],
  viewerIndex: 0
};

const els = {
  form: document.querySelector("#listingForm"),
  recordId: document.querySelector("#recordId"),
  clearBtn: document.querySelector("#clearBtn"),
  siteUrl: document.querySelector("#siteUrl"),
  visitDate: document.querySelector("#visitDate"),
  address: document.querySelector("#address"),
  commentInput: document.querySelector("#commentInput"),
  addCommentBtn: document.querySelector("#addCommentBtn"),
  commentCount: document.querySelector("#commentCount"),
  commentPreview: document.querySelector("#commentPreview"),
  visited: document.querySelector("#visited"),
  photos: document.querySelector("#photos"),
  photoPreview: document.querySelector("#photoPreview"),
  recordsList: document.querySelector("#recordsList"),
  counter: document.querySelector("#counter"),
  addressSearch: document.querySelector("#addressSearch"),
  commentSearch: document.querySelector("#commentSearch"),
  dateSearch: document.querySelector("#dateSearch"),
  resetSearchBtn: document.querySelector("#resetSearchBtn"),
  addRecordBtn: document.querySelector("#addRecordBtn"),
  recordModal: document.querySelector("#recordModal"),
  closeModalBtn: document.querySelector("#closeModalBtn"),
  modalTitle: document.querySelector("#modalTitle"),
  imageViewer: document.querySelector("#imageViewer"),
  closeViewerBtn: document.querySelector("#closeViewerBtn"),
  viewerImage: document.querySelector("#viewerImage"),
  viewerMeta: document.querySelector("#viewerMeta"),
  prevPhotoBtn: document.querySelector("#prevPhotoBtn"),
  nextPhotoBtn: document.querySelector("#nextPhotoBtn"),
  mapViewer: document.querySelector("#mapViewer"),
  closeMapBtn: document.querySelector("#closeMapBtn"),
  mapFrame: document.querySelector("#mapFrame"),
  mapViewerAddress: document.querySelector("#mapViewerAddress"),
  openYandexMapLink: document.querySelector("#openYandexMapLink"),
  exportBtn: document.querySelector("#exportBtn"),
  loadProjectBtn: document.querySelector("#loadProjectBtn"),
  saveProjectBtn: document.querySelector("#saveProjectBtn"),
  shareProjectBtn: document.querySelector("#shareProjectBtn"),
  installBtn: document.querySelector("#installBtn"),
  offlineStatus: document.querySelector("#offlineStatus"),
  template: document.querySelector("#recordTemplate")
};

let dbPromise;
let installPrompt;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function transact(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getAllRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result.map(normalizeRecord));
    request.onerror = () => reject(request.error);
  });
}

async function saveRecord(record) {
  await transact("readwrite", store => store.put(record));
}

async function deleteRecord(id) {
  const record = state.records.find(item => item.id === id);
  if (!record) return;

  const now = new Date().toISOString();
  await saveRecord({
    ...record,
    deletedAt: now,
    updatedAt: now
  });
}

async function mergeRecords(records) {
  const current = await getAllRecords();
  const merged = new Map(current.map(record => [record.id, record]));

  records.map(normalizeRecord).forEach(record => {
    const existing = merged.get(record.id);
    merged.set(record.id, existing ? mergeRecord(existing, record) : record);
  });

  const normalized = [...merged.values()];
  await transact("readwrite", store => {
    store.clear();
    normalized.forEach(record => store.put(record));
  });
  return normalized.filter(record => !record.deletedAt).length;
}

function compareRecordUpdatedAt(a, b) {
  const aTime = Date.parse(a.updatedAt || "") || 0;
  const bTime = Date.parse(b.updatedAt || "") || 0;
  return aTime - bTime;
}

function mergeRecord(existingRecord, incomingRecord) {
  const existing = normalizeRecord(existingRecord);
  const incoming = normalizeRecord(incomingRecord);
  const newer = compareRecordUpdatedAt(incoming, existing) >= 0 ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  const deletedAt = resolveDeletedAt(newer, older);

  return {
    ...older,
    ...newer,
    ...(deletedAt ? { deletedAt } : { deletedAt: undefined }),
    comments: mergeNestedItems(existing.comments, incoming.comments),
    photos: mergeNestedItems(existing.photos, incoming.photos),
    updatedAt: maxIsoDate(existing.updatedAt, incoming.updatedAt) || newer.updatedAt
  };
}

function mergeNestedItems(existingItems = [], incomingItems = []) {
  const merged = new Map();
  existingItems.forEach(item => merged.set(item.id, item));
  incomingItems.forEach(item => {
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? mergeNestedItem(existing, item) : item);
  });
  return [...merged.values()];
}

function mergeNestedItem(existing, incoming) {
  const incomingWins = itemTimestamp(incoming) >= itemTimestamp(existing);
  const newer = incomingWins ? incoming : existing;
  const older = incomingWins ? existing : incoming;
  const deletedAt = resolveDeletedAt(newer, older);
  return {
    ...older,
    ...newer,
    ...(deletedAt ? { deletedAt } : { deletedAt: undefined })
  };
}

function resolveDeletedAt(newer, older) {
  const deletedAt = maxIsoDate(newer.deletedAt, older.deletedAt);
  if (!deletedAt) return undefined;
  const deleteTime = Date.parse(deletedAt) || 0;
  const activeTime = Math.max(itemTimestamp({ ...newer, deletedAt: undefined }), itemTimestamp({ ...older, deletedAt: undefined }));
  return deleteTime >= activeTime ? deletedAt : undefined;
}

function itemTimestamp(item) {
  return Date.parse(item.updatedAt || item.deletedAt || item.createdAt || "") || 0;
}

function maxIsoDate(...values) {
  return values
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0];
}

function normalizeRecord(record) {
  const legacyComment = typeof record.comments === "string" && record.comments.trim()
    ? [{ id: crypto.randomUUID(), text: record.comments.trim(), createdAt: record.updatedAt || new Date().toISOString() }]
    : [];

  return {
    ...record,
    comments: Array.isArray(record.comments) ? record.comments : legacyComment,
    photos: Array.isArray(record.photos) ? record.photos : []
  };
}

async function fileToPhoto(file) {
  const compressed = await compressImage(file);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ".jpg"),
    type: compressed.type,
    dataUrl: compressed.dataUrl,
    originalSize: file.size,
    storedSize: compressed.size,
    createdAt: new Date().toISOString()
  };
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
        resolve({
          type: "image/jpeg",
          dataUrl,
          size: dataUrlSize(dataUrl),
          width,
          height
        });
      };
      image.onerror = () => reject(new Error("Не удалось обработать фото"));
      image.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round(base64.length * 0.75);
}

function activeItems(items = []) {
  return items.filter(item => !item.deletedAt);
}

async function handlePhotos(files) {
  const photos = await Promise.all(Array.from(files).map(fileToPhoto));
  state.photos = [...state.photos, ...photos];
  els.photos.value = "";
  renderPhotoPreview();
}

function addComment() {
  const text = els.commentInput.value.trim();
  if (!text) return;

  state.comments = [
    ...state.comments,
    { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }
  ];
  els.commentInput.value = "";
  renderCommentPreview();
}

function removeComment(id) {
  const now = new Date().toISOString();
  state.comments = state.comments.map(comment => comment.id === id ? { ...comment, deletedAt: now } : comment);
  renderCommentPreview();
}

function removePhoto(id) {
  const now = new Date().toISOString();
  state.photos = state.photos.map(photo => photo.id === id ? { ...photo, deletedAt: now } : photo);
  renderPhotoPreview();
}

function renderCommentPreview() {
  els.commentPreview.innerHTML = "";
  const comments = activeItems(state.comments);
  els.commentCount.textContent = String(comments.length);

  comments.forEach(comment => {
    els.commentPreview.append(createCommentElement(comment, true));
  });
}

function renderPhotoPreview() {
  els.photoPreview.innerHTML = "";
  activeItems(state.photos).forEach(photo => {
    const item = document.createElement("div");
    item.className = "photo-item";

    const img = document.createElement("img");
    img.className = "photo-preview";
    img.src = photo.dataUrl;
    img.alt = photo.name || "Фото объекта";
    img.addEventListener("click", () => openImageViewer(activeItems(state.photos), photo.id));

    const button = document.createElement("button");
    button.className = "photo-remove";
    button.type = "button";
    button.textContent = "×";
    button.title = "Удалить фото";
    button.addEventListener("click", () => removePhoto(photo.id));

    const size = document.createElement("span");
    size.className = "photo-size";
    size.textContent = formatBytes(photo.storedSize || dataUrlSize(photo.dataUrl));

    item.append(img, button, size);
    els.photoPreview.append(item);
  });
}

function createCommentElement(comment, editable = false) {
  const item = document.createElement("div");
  item.className = "comment-item";

  const row = document.createElement("div");
  row.className = "comment-row";

  const text = document.createElement("div");
  text.className = "comment-text";
  text.textContent = comment.text;

  row.append(text);

  if (editable) {
    const button = document.createElement("button");
    button.className = "danger comment-delete";
    button.type = "button";
    button.textContent = "Удалить";
    button.addEventListener("click", () => removeComment(comment.id));
    row.append(button);
  }

  const time = document.createElement("time");
  time.dateTime = comment.createdAt || "";
  time.textContent = formatDateTime(comment.createdAt);

  item.append(row, time);
  return item;
}

function recordFromForm() {
  return {
    id: els.recordId.value || crypto.randomUUID(),
    siteUrl: els.siteUrl.value.trim(),
    address: els.address.value.trim(),
    visited: els.visited.checked,
    visitDate: els.visitDate.value,
    comments: state.comments,
    photos: state.photos,
    updatedAt: new Date().toISOString()
  };
}

function resetForm() {
  els.form.reset();
  els.recordId.value = "";
  state.comments = [];
  state.photos = [];
  els.modalTitle.textContent = "Добавить дом";
  renderCommentPreview();
  renderPhotoPreview();
}

function openModal(mode = "add") {
  els.modalTitle.textContent = mode === "edit" ? "Изменить дом" : "Добавить дом";
  els.recordModal.classList.add("open");
  els.recordModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  window.setTimeout(() => els.address.focus(), 0);
}

function closeModal() {
  els.recordModal.classList.remove("open");
  els.recordModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openAddModal() {
  resetForm();
  openModal("add");
}

async function refresh() {
  state.records = (await getAllRecords()).sort((a, b) => {
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  renderRecords();
}

function filteredRecords() {
  return state.records.filter(record => {
    if (record.deletedAt) return false;
    if (state.filter === "visited" && !record.visited) return false;
    if (state.filter === "pending" && record.visited) return false;
    if (state.addressQuery && !record.address.toLowerCase().includes(state.addressQuery)) return false;
    if (state.commentQuery && !activeItems(record.comments).some(comment => comment.text.toLowerCase().includes(state.commentQuery))) return false;
    if (state.dateQuery && record.visitDate !== state.dateQuery) return false;
    return true;
  });
}

function renderRecords() {
  const records = filteredRecords();
  const activeRecords = state.records.filter(record => !record.deletedAt);
  els.recordsList.innerHTML = "";
  els.counter.textContent = records.length === activeRecords.length
    ? `${activeRecords.length} ${decline(activeRecords.length, "запись", "записи", "записей")}`
    : `${records.length} из ${activeRecords.length}`;

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = activeRecords.length ? "Ничего не найдено" : "Пока нет записей";
    els.recordsList.append(empty);
    return;
  }

  records.forEach(record => {
    const card = els.template.content.firstElementChild.cloneNode(true);
    const photos = card.querySelector(".record-photos");
    const title = card.querySelector("h3");
    const badge = card.querySelector(".badge");
    const meta = card.querySelector(".meta");
    const comments = card.querySelector(".record-comments");
    const link = card.querySelector(".site-link");

    title.textContent = record.address || "Без адреса";
    badge.textContent = record.visited ? "посещено" : "новое";
    badge.classList.toggle("done", record.visited);
    const visibleComments = activeItems(record.comments);
    const visiblePhotos = activeItems(record.photos);
    meta.textContent = [
      record.visitDate ? `Дата: ${record.visitDate}` : "Дата не указана",
      `${visibleComments.length} ${decline(visibleComments.length, "комментарий", "комментария", "комментариев")}`,
      `${visiblePhotos.length} ${decline(visiblePhotos.length, "фото", "фото", "фото")}`
    ].join(" · ");

    if (record.siteUrl) {
      link.href = record.siteUrl;
      link.textContent = record.siteUrl;
    } else {
      link.remove();
    }

    visiblePhotos.forEach(photo => {
      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = photo.name || "Фото объекта";
      img.addEventListener("click", () => openImageViewer(visiblePhotos, photo.id));
      photos.append(img);
    });

    if (!visiblePhotos.length) {
      photos.remove();
      card.style.gridTemplateColumns = "1fr";
    }

    if (visibleComments.length) {
      visibleComments.forEach(comment => comments.append(createCommentElement(comment)));
    } else {
      comments.remove();
    }

    if (!record.address) {
      card.querySelector(".map").remove();
    }

    card.querySelector(".edit").addEventListener("click", () => editRecord(record));
    card.querySelector(".map")?.addEventListener("click", () => openMapViewer(record.address));
    card.querySelector(".share").addEventListener("click", () => shareRecord(record));
    card.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm("Удалить запись?")) return;
      await deleteRecord(record.id);
      await refresh();
    });

    els.recordsList.append(card);
  });
}

function editRecord(record) {
  els.recordId.value = record.id;
  els.siteUrl.value = record.siteUrl || "";
  els.address.value = record.address || "";
  els.visited.checked = Boolean(record.visited);
  els.visitDate.value = record.visitDate || "";
  state.comments = [...record.comments];
  state.photos = [...record.photos];
  renderCommentPreview();
  renderPhotoPreview();
  openModal("edit");
}

function openImageViewer(photos, photoId) {
  if (!photos.length) return;
  state.viewerPhotos = photos;
  state.viewerIndex = Math.max(0, photos.findIndex(photo => photo.id === photoId));
  els.imageViewer.classList.add("open");
  els.imageViewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  renderImageViewer();
}

function closeImageViewer() {
  els.imageViewer.classList.remove("open");
  els.imageViewer.setAttribute("aria-hidden", "true");
  state.viewerPhotos = [];
  state.viewerIndex = 0;
  if (!els.recordModal.classList.contains("open")) {
    document.body.classList.remove("modal-open");
  }
}

function renderImageViewer() {
  const photo = state.viewerPhotos[state.viewerIndex];
  if (!photo) return;

  els.viewerImage.src = photo.dataUrl;
  els.viewerImage.alt = photo.name || "Фото объекта";
  els.viewerMeta.textContent = [
    `${state.viewerIndex + 1} из ${state.viewerPhotos.length}`,
    photo.name || "",
    formatBytes(photo.storedSize || dataUrlSize(photo.dataUrl))
  ].filter(Boolean).join(" · ");

  els.prevPhotoBtn.disabled = state.viewerIndex <= 0;
  els.nextPhotoBtn.disabled = state.viewerIndex >= state.viewerPhotos.length - 1;
}

function showPrevPhoto() {
  if (state.viewerIndex <= 0) return;
  state.viewerIndex -= 1;
  renderImageViewer();
}

function showNextPhoto() {
  if (state.viewerIndex >= state.viewerPhotos.length - 1) return;
  state.viewerIndex += 1;
  renderImageViewer();
}

function openMapViewer(address) {
  if (!address) return;
  els.mapViewerAddress.textContent = address;
  els.mapFrame.src = buildYandexMapEmbedUrl(address);
  els.openYandexMapLink.href = buildYandexMapUrl(address);
  els.mapViewer.classList.add("open");
  els.mapViewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeMapViewer() {
  els.mapViewer.classList.remove("open");
  els.mapViewer.setAttribute("aria-hidden", "true");
  els.mapFrame.src = "";
  if (!els.recordModal.classList.contains("open") && !els.imageViewer.classList.contains("open")) {
    document.body.classList.remove("modal-open");
  }
}

function buildYandexMapEmbedUrl(address) {
  return `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(address)}&z=16`;
}

function buildYandexMapUrl(address) {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

async function shareRecord(record) {
  const text = buildShareText(record);
  const files = await photosToFiles(activeItems(record.photos));

  if (navigator.canShare && files.length && navigator.canShare({ files })) {
    try {
      await navigator.share({ title: record.address || "Вариант дома", text, files });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: record.address || "Вариант дома", text, url: record.siteUrl || undefined });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const url = record.siteUrl || "";
  const telegram = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  window.open(telegram, "_blank", "noopener,noreferrer");
}

function buildShareText(record) {
  const comments = activeItems(record.comments).map(comment => `- ${comment.text}`).join("\n");
  return [
    record.address,
    record.visitDate ? `Дата: ${record.visitDate}` : "",
    record.visited ? "Посещено" : "Не посещено",
    comments ? `Комментарии:\n${comments}` : "",
    record.siteUrl
  ].filter(Boolean).join("\n");
}

async function photosToFiles(photos) {
  const files = [];
  for (const photo of photos) {
    const response = await fetch(photo.dataUrl);
    const blob = await response.blob();
    files.push(new File([blob], photo.name || "house.jpg", { type: photo.type || blob.type }));
  }
  return files;
}

function decline(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `houses-mappe-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

function setProjectId(projectId) {
  state.projectId = projectId;
  localStorage.setItem(PROJECT_ID_KEY, projectId);
  const url = new URL(location.href);
  url.searchParams.set("project", projectId);
  history.replaceState(null, "", url);
}

function parseProjectId(value) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("project") || "";
  } catch {
    return trimmed;
  }
}

function projectShareUrl() {
  const url = new URL(location.href);
  url.searchParams.set("project", state.projectId);
  return url.toString();
}

async function saveProject() {
  const payload = JSON.stringify({ records: state.records });
  const project = state.projectId
    ? await requestJson(`/api/projects/${encodeURIComponent(state.projectId)}`, { method: "PUT", body: payload })
    : await requestJson("/api/projects", { method: "POST", body: payload });

  setProjectId(project.id);
  showStatus(`Проект сохранен: ${project.id}`);
}

async function loadProject({ silent = false } = {}) {
  const input = state.projectId || prompt("ID проекта или ссылка");
  if (!input) return;

  const projectId = parseProjectId(input);
  if (!projectId) {
    showStatus("Не удалось распознать ID проекта.");
    return;
  }

  const project = await requestJson(`/api/projects/${encodeURIComponent(projectId)}`);
  const total = await mergeRecords(project.records || []);
  setProjectId(project.id);
  await refresh();
  showStatus(`Проект загружен и объединен: ${total}`);
}

async function shareProject() {
  if (!state.projectId) {
    await saveProject();
  }

  const url = projectShareUrl();
  if (navigator.share) {
    await navigator.share({ title: "Карта домов", url });
    return;
  }

  await navigator.clipboard.writeText(url);
  showStatus("Ссылка скопирована.");
}

async function runProjectAction(action) {
  try {
    await action();
  } catch (error) {
    showStatus(error.message || "Ошибка синхронизации.");
  }
}

function showStatus(message) {
  els.offlineStatus.textContent = message;
  els.offlineStatus.classList.add("show");
  window.setTimeout(() => els.offlineStatus.classList.remove("show"), 3600);
}

els.addRecordBtn.addEventListener("click", openAddModal);
els.clearBtn.addEventListener("click", resetForm);
els.closeModalBtn.addEventListener("click", closeModal);
els.closeViewerBtn.addEventListener("click", closeImageViewer);
els.closeMapBtn.addEventListener("click", closeMapViewer);
els.prevPhotoBtn.addEventListener("click", showPrevPhoto);
els.nextPhotoBtn.addEventListener("click", showNextPhoto);
els.addCommentBtn.addEventListener("click", addComment);
els.photos.addEventListener("change", event => handlePhotos(event.target.files));
els.exportBtn.addEventListener("click", exportJson);
els.saveProjectBtn.addEventListener("click", () => runProjectAction(saveProject));
els.loadProjectBtn.addEventListener("click", () => runProjectAction(loadProject));
els.shareProjectBtn.addEventListener("click", () => runProjectAction(shareProject));

els.addressSearch.addEventListener("input", event => {
  state.addressQuery = event.target.value.trim().toLowerCase();
  renderRecords();
});

els.commentSearch.addEventListener("input", event => {
  state.commentQuery = event.target.value.trim().toLowerCase();
  renderRecords();
});

els.dateSearch.addEventListener("change", event => {
  state.dateQuery = event.target.value;
  renderRecords();
});

els.resetSearchBtn.addEventListener("click", () => {
  state.addressQuery = "";
  state.commentQuery = "";
  state.dateQuery = "";
  els.addressSearch.value = "";
  els.commentSearch.value = "";
  els.dateSearch.value = "";
  renderRecords();
});

els.recordModal.addEventListener("click", event => {
  if (event.target.hasAttribute("data-close-modal")) {
    closeModal();
  }
});

els.imageViewer.addEventListener("click", event => {
  if (event.target.hasAttribute("data-close-viewer")) {
    closeImageViewer();
  }
});

els.mapViewer.addEventListener("click", event => {
  if (event.target.hasAttribute("data-close-map")) {
    closeMapViewer();
  }
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && els.mapViewer.classList.contains("open")) {
    closeMapViewer();
    return;
  }
  if (event.key === "Escape" && els.imageViewer.classList.contains("open")) {
    closeImageViewer();
    return;
  }
  if (event.key === "ArrowLeft" && els.imageViewer.classList.contains("open")) {
    showPrevPhoto();
    return;
  }
  if (event.key === "ArrowRight" && els.imageViewer.classList.contains("open")) {
    showNextPhoto();
    return;
  }
  if (event.key === "Escape" && els.recordModal.classList.contains("open")) {
    closeModal();
  }
});

els.commentInput.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    addComment();
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  els.installBtn.hidden = true;
});

els.form.addEventListener("submit", async event => {
  event.preventDefault();
  addComment();

  const record = recordFromForm();
  if (!record.siteUrl && !record.address && !activeItems(record.comments).length && !activeItems(record.photos).length) return;

  await saveRecord(record);
  resetForm();
  closeModal();
  await refresh();
});

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach(item => item.classList.toggle("active", item === button));
    renderRecords();
  });
});

renderCommentPreview();
renderPhotoPreview();
refresh().then(() => {
  if (state.projectId) {
    runProjectAction(() => loadProject({ silent: !state.records.length }));
  }
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js")
    .then(() => showStatus("Офлайн-кэш включен. После установки приложение будет работать без компьютера."))
    .catch(() => showStatus("Приложение работает, но офлайн-кэш не включился."));
} else if (location.protocol === "file:") {
  showStatus("Открыто как файл: сохранение работает, но установка PWA недоступна.");
}
