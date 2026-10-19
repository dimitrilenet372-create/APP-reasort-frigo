// Scriptable — Widget en lecture seule pour les stocks de l'hôtel.
const DB = "https://hostel-stock-dealer-default-rtdb.europe-west1.firebasedatabase.app/hotel/state.json";
const APP = "https://dimitrilenet372-create.github.io/APP-reasort-frigo/?rapide";

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
const isFeaturedCategory = item => ["glaces", "patisserie"].includes(normalizeName(item.g));
const level = item => {
  if (!item.ok) return "out";
  const quantity = Number(item.q) || 0;
  const maximum = Number(item.max) || 0;
  if (maximum > 0) {
    if (quantity >= maximum) return "full";
    if (quantity * 2 < maximum) return "low";
    return "ok";
  }
  return "";
};
const needsRestock = item => ["out", "low"].includes(level(item));
const label = item => item.n + (Number(item.max) > 0 ? "  " + item.q + "/" + item.max : "");

let data = null;
let loadError = null;
try {
  data = await new Request(DB).loadJSON();
} catch (error) {
  loadError = error;
}

const family = config.widgetFamily || "medium";
const maxLines = family === "small" ? 3 : family === "large" ? 14 : 5;
const fontSize = family === "large" ? 13 : 12;

const widget = new ListWidget();
widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1b2027"));
widget.url = APP;
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
  const bar = arr(data.bar);
  const kitchen = arr(data.cuisine);
  const stock = arr(data.stock);
  const stockKeys = new Set(stock.map(item => normalizeName(item.n)));

  const refill = [...bar, ...kitchen].filter(needsRestock);
  refill.sort((left, right) => Number(isFeaturedCategory(right)) - Number(isFeaturedCategory(left)));
  const featuredRefill = refill.filter(isFeaturedCategory);
  const buy = [];
  const seen = new Set();
  for (const item of stock) {
    const key = normalizeName(item.n);
    if (needsRestock(item) && !seen.has(key)) {
      seen.add(key);
      buy.push(item);
    }
  }
  for (const item of [...bar, ...kitchen]) {
    const key = normalizeName(item.n);
    if (needsRestock(item) && !stockKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      buy.push(item);
    }
  }

  const columns = widget.addStack();
  columns.topAlignContent();
  if (family === "small") columns.layoutVertically();

  const addColumn = (name, color, items, formatItem = label) => {
    const column = columns.addStack();
    column.layoutVertically();
    const heading = column.addText(name + " (" + items.length + ")");
    heading.font = Font.boldSystemFont(12);
    heading.textColor = color;
    column.addSpacer(3);

    if (!items.length) {
      const empty = column.addText("✅ Rien");
      empty.font = Font.systemFont(fontSize);
      empty.textOpacity = 0.7;
    }

    items.slice(0, maxLines).forEach(item => {
      const text = column.addText("• " + formatItem(item));
      text.font = Font.systemFont(fontSize);
      text.lineLimit = 1;
    });

    if (items.length > maxLines) {
      const more = column.addText("+ " + (items.length - maxLines) + " autres");
      more.font = Font.systemFont(11);
      more.textOpacity = 0.6;
    }
  };

  if (family === "small") {
    const visibleRefill = featuredRefill.length ? featuredRefill : refill;
    const heading = featuredRefill.length ? "🍦 Glaces & pâtisseries" : "🍹🍳 À remplir";
    addColumn(heading, Color.orange(), visibleRefill, item =>
      isFeaturedCategory(item) ? item.g + " · " + label(item) : label(item)
    );
  } else {
    addColumn("🍹🍳 À remplir", Color.orange(), refill, item =>
      isFeaturedCategory(item) ? item.g + " · " + label(item) : label(item)
    );
    columns.addSpacer(14);
    addColumn("🛒 À racheter", Color.red(), buy);
  }
}

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
