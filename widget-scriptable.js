// Scriptable — Stocks interactifs de glaces, sorbets et pâtisseries.
const DB = "https://hostel-stock-dealer-default-rtdb.europe-west1.firebasedatabase.app/hotel/state.json";
const SCRIPT_NAME = "Stocks hôtel";

const arr = value => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.keys(value)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => value[key]);
};
const normalizeName = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();
const label = item => item.n + (Number(item.max) > 0 ? "  " + item.q + "/" + item.max : "");
const dessertGroup = item => {
  const group = normalizeName(item.g);
  if (group.includes("sorbet")) return "Sorbets";
  if (group.includes("glace")) return "Glaces";
  if (group.includes("patisser")) return "Pâtisserie";
  return null;
};
const scriptRunUrl = parameters => {
  const query = Object.keys(parameters)
    .map(key => encodeURIComponent(key) + "=" + encodeURIComponent(parameters[key]))
    .join("&");
  return "scriptable:///run?scriptName=" + encodeURIComponent(SCRIPT_NAME) + "&" + query;
};

async function chooseDessert(groupName) {
  const items = arr(data && data.cuisine)
    .map((item, index) => ({ item, index }))
    .filter(entry => dessertGroup(entry.item) === groupName);
  if (!items.length) return -1;

  const picker = new Alert();
  picker.title = groupName;
  picker.message = "Choisis un produit à modifier";
  items.forEach(entry => {
    picker.addAction(entry.item.n + " · " + label(entry.item));
  });
  picker.addCancelAction("Annuler");
  const selected = await picker.presentAlert();
  return selected < 0 ? -1 : items[selected].index;
}

async function editDessert(index) {
  const items = arr(data && data.cuisine);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new Error("Produit introuvable. Actualise le widget et réessaie.");
  }

  const item = items[index];
  if (!dessertGroup(item)) {
    throw new Error("Ce produit n'est pas une glace, un sorbet ou une pâtisserie.");
  }

  const currentQuantity = Math.max(0, Number(item.q) || 0);
  const choice = new Alert();
  choice.title = item.n;
  choice.message = "Quantité actuelle : " + currentQuantity +
    (Number(item.max) > 0 ? " / " + item.max : "");
  choice.addAction("− 1");
  choice.addAction("+ 1");
  choice.addAction("Saisir une quantité");
  choice.addCancelAction("Annuler");
  const selected = await choice.presentAlert();
  if (selected < 0) return;

  let nextQuantity = currentQuantity;
  if (selected === 0) nextQuantity = Math.max(0, currentQuantity - 1);
  else if (selected === 1) nextQuantity = Math.min(9999, currentQuantity + 1);
  else {
    const input = new Alert();
    input.title = "Quantité — " + item.n;
    input.addTextField("Nombre", String(currentQuantity));
    input.addAction("Enregistrer");
    input.addCancelAction("Annuler");
    if (await input.presentAlert() !== 0) return;

    const value = input.textFieldValue(0).trim();
    if (!/^\d+$/.test(value) || Number(value) > 9999) {
      const invalid = new Alert();
      invalid.title = "Quantité invalide";
      invalid.message = "Entre un nombre entier entre 0 et 9999.";
      invalid.addAction("OK");
      await invalid.presentAlert();
      return;
    }
    nextQuantity = Number(value);
  }

  if (nextQuantity === currentQuantity) return;

  const updatedAt = Date.now();
  const update = new Request(DB);
  update.method = "PATCH";
  update.headers = { "Content-Type": "application/json" };
  update.body = JSON.stringify({
    ["cuisine/" + index + "/q"]: nextQuantity,
    ["cuisine/" + index + "/ok"]: nextQuantity > 0,
    updated: updatedAt
  });
  await update.loadString();
  if (!update.response || update.response.statusCode < 200 || update.response.statusCode >= 300) {
    throw new Error("Firebase a refusé la modification (HTTP " +
      (update.response ? update.response.statusCode : "inconnu") + ").");
  }

  const confirmation = new Alert();
  confirmation.title = "Stock mis à jour";
  confirmation.message = item.n + " : " + nextQuantity +
    (Number(item.max) > 0 ? " / " + item.max : "");
  confirmation.addAction("OK");
  await confirmation.presentAlert();
}

let data = null;
let loadError = null;
try {
  data = await new Request(DB).loadJSON();
} catch (error) {
  loadError = error;
}

const queryParameters = args.queryParameters || {};
if (queryParameters.group || queryParameters.edit === "1") {
  try {
    if (!data || typeof data !== "object") {
      throw new Error(loadError ? String(loadError) : "Impossible de lire les stocks Firebase.");
    }
    const index = queryParameters.group
      ? await chooseDessert(queryParameters.group)
      : Number(queryParameters.index);
    if (index >= 0) await editDessert(index);
  } catch (error) {
    const alert = new Alert();
    alert.title = "Modification impossible";
    alert.message = String(error);
    alert.addAction("OK");
    await alert.presentAlert();
    console.error("Widget inventory update failed:", error);
  }
  Script.complete();
}

const family = config.widgetFamily || "medium";
const fontSize = family === "large" ? 13 : 12;

const widget = new ListWidget();
widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1b2027"));
widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

const header = widget.addStack();
header.centerAlignContent();
const title = header.addText("🧊 Stocks");
title.font = Font.boldSystemFont(14);
header.addSpacer();
const time = header.addText(new Date().toLocaleTimeString("fr-FR", {
  hour: "2-digit",
  minute: "2-digit"
}));
time.font = Font.systemFont(10);
time.textOpacity = 0.6;
widget.addSpacer(6);

if (!data || typeof data !== "object") {
  const message = loadError
    ? "⚠️ Firebase : " + String(loadError).slice(0, 90)
    : "⚠️ Aucune donnée disponible";
  const errorText = widget.addText(message);
  errorText.font = Font.systemFont(12);
} else {
  const desserts = arr(data.cuisine)
    .map((item, index) => ({ item, index, group: dessertGroup(item) }))
    .filter(entry => entry.group);
  const groupOrder = ["Sorbets", "Glaces", "Pâtisserie"];

  const columns = widget.addStack();
  columns.layoutVertically();
  columns.topAlignContent();
  const instruction = columns.addText("Touchez une catégorie ou un produit pour ajuster");
  instruction.font = Font.systemFont(10);
  instruction.textOpacity = 0.65;
  columns.addSpacer(4);

  groupOrder.forEach(groupName => {
    const entries = desserts.filter(entry => entry.group === groupName);
    if (!entries.length) return;
    const total = entries.reduce((sum, entry) => sum + (Number(entry.item.q) || 0), 0);
    const maximum = entries.reduce((sum, entry) => sum + (Number(entry.item.max) || 0), 0);
    const heading = columns.addText(groupName + "  " + total + "/" + maximum);
    heading.font = Font.boldSystemFont(12);
    heading.textColor = groupName === "Sorbets" ? Color.blue() :
      groupName === "Glaces" ? Color.orange() : Color.red();
    heading.url = scriptRunUrl({ group: groupName });

    const itemLimit = family === "large" ? entries.length : family === "medium" ? 1 : 0;
    entries.slice(0, itemLimit).forEach(entry => {
      const text = columns.addText("• " + label(entry.item));
      text.font = Font.systemFont(fontSize);
      text.lineLimit = 1;
      text.url = scriptRunUrl({ edit: "1", index: entry.index });
    });

    if (itemLimit > 0 && entries.length > itemLimit) {
      const more = columns.addText("+ " + (entries.length - itemLimit) + " autres");
      more.font = Font.systemFont(10);
      more.textOpacity = 0.65;
    }
  });
}

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
