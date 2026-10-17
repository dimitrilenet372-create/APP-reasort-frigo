var INVENTORY_STORAGE_KEY = 'frigos-hotel-v3';
var LANGUAGE_STORAGE_KEY = 'frigos-language';
var LANGUAGE_TEXTS = window.FRIGOS_I18N;
var language = 'fr';
var syncStatusKey = 'syncLoading';

try {
  var savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (LANGUAGE_TEXTS[savedLanguage]) language = savedLanguage;
} catch (error) {}

function translate(key) {
  return LANGUAGE_TEXTS[language][key] || LANGUAGE_TEXTS.fr[key] || key;
}

// Keep the saved product fields (n, g, q, ok, shop) unchanged for compatibility.
function createItems(group, products) {
  return products.map(function (product) {
    return {
      n: product[0],
      g: group,
      q: product[1],
      ok: product[1] > 0,
      shop: ''
    };
  });
}

// These defaults are used only when no saved inventory exists.
var inventory = {
  bar: [].concat(
    createItems('Sodas & softs', [
      ['Coca zero', 10], ['Coca', 10], ['Limonade', 10],
      ['Limonade Coclicot', 2], ['Tonic', 10], ['Ginger-beer', 10],
      ['Cola Pachamama', 5], ['Perrier', 10], ['Thé glacé', 2]
    ]),
    createItems('Jus', [
      ["Jus d'orange", 2], ['Jus de pomme', 3], ["Jus d'ananas", 2],
      ["Jus d'abricot", 3], ['Jus de mangue', 2],
      ['Jus de framboise', 6], ['Jus de poire', 6]
    ]),
    createItems('Lait', [['Lait', 6], ["Lait d'amande", 2]]),
    createItems('Bières', [
      ['Bière ambrée', 4], ['Bière blanche', 4],
      ['Bière blonde', 4], ['Bière blonde bio', 2]
    ]),
    createItems('Vins & bulles', [
      ['Prosecco', 2], ['Champagne grande réserve', 2],
      ['Vin rosé Minuty', 1], ['Vin rosé Preignes', 1],
      ['Vin blanc Chardonnay', 3], ['Vin blanc Chablis', 3],
      ['Vin blanc Pouilly-Fumé', 3],
      ['Vin blanc Coteaux du Layon', 3], ['Cidre', 1]
    ])
  ),
  cuisine: [].concat(
    createItems('Pâtisserie', [
      ['Flan', 1], ['Cannelé', 0], ['Fondant', 1], ['Brownie', 0]
    ]),
    createItems('Fromages', [
      ['Comté 18 mois', 1], ['Saint-Môret', 0], ['Brie de Meaux', 1],
      ["Fourme d'Ambert", 1], ['Tomme aux fleurs', 1]
    ]),
    createItems('Charcuterie', [
      ['Jambon Forêt-Noire', 1], ['Spianata piccante', 1],
      ['Pâté de canard', 1]
    ]),
    createItems('Légumes', [
      ['Salades', 1], ['Tomates', 0], ['Carottes', 1]
    ])
  ),
  stock: null,
  shops: ['Metro', 'La Vie Claire'],
  history: [],
  tel: ''
};

// Read the previous storage key first, then let the current version take priority.
try {
  var legacyInventory = JSON.parse(
    localStorage.getItem('frigos-hotel-v2') || 'null'
  );
  if (legacyInventory) {
    inventory.tel = legacyInventory.tel || '';
    if (legacyInventory.shops) inventory.shops = legacyInventory.shops;
  }
} catch (error) {}

try {
  var savedInventory = JSON.parse(
    localStorage.getItem(INVENTORY_STORAGE_KEY) || 'null'
  );
  if (savedInventory && savedInventory.bar && savedInventory.cuisine) {
    inventory = savedInventory;
    if (!inventory.shops) inventory.shops = ['Metro', 'La Vie Claire'];
  }
} catch (error) {}

if (!Array.isArray(inventory.history)) inventory.history = [];

// Create a separate, initially unfilled stock inventory when upgrading old saves.
if (!Array.isArray(inventory.stock)) {
  inventory.stock = inventory.bar.map(function (item) {
    return {
      n: item.n, g: item.g, q: 0, max: 0, ok: true, shop: item.shop || ''
    };
  }).concat(inventory.cuisine.map(function (item) {
    return {
      n: item.n, g: item.g, q: 0, max: 0, ok: true, shop: item.shop || ''
    };
  }));
}

var activeFridge = 'bar';
var searchByFridge = { bar: '', cuisine: '', stock: '' };
var fridgeTabs = [['bar'], ['cuisine'], ['stock']];
var inventoryBody = document.getElementById('body');
var searchInput = document.getElementById('s');
var categorySelect = document.getElementById('cat');
var newCategoryInput = document.getElementById('nc');

normalizeStockLimits();

function saveInventory(localOnly) {
  if (!localOnly) {
    inventory.updated = Date.now();
    inventory.dirty = true;
  }
  try {
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inventory));
  } catch (error) {}
  if (!localOnly && window.cloudSave) window.cloudSave();
}

function recordHistory(entry) {
  entry.at = Date.now();
  entry.undone = false;
  inventory.history.push(entry);
  if (inventory.history.length > 50) inventory.history.shift();
  renderHistory();
}

function formatHistoryEntry(entry) {
  var name = escapeHtml(entry.itemName || (entry.item && entry.item.n) || '');
  var description;

  if (entry.type === 'quantity') {
    description = translate('historyQuantity')
      .replace('{name}', name)
      .replace('{before}', entry.before)
      .replace('{after}', entry.after);
  } else if (entry.type === 'maximum') {
    description = translate('historyMaximum')
      .replace('{name}', name)
      .replace('{before}', entry.before)
      .replace('{after}', entry.after);
  } else if (entry.type === 'presence') {
    description = translate('historyPresence')
      .replace('{name}', name)
      .replace('{before}', translate(entry.before ? 'present' : 'restock'))
      .replace('{after}', translate(entry.after ? 'present' : 'restock'));
  } else if (entry.type === 'shop') {
    description = translate('historyShop')
      .replace('{name}', name)
      .replace('{before}', escapeHtml(entry.before || translate('storeUnknown')))
      .replace('{after}', escapeHtml(entry.after || translate('storeUnknown')));
  } else if (entry.type === 'add') {
    description = translate('historyAdded').replace('{name}', name);
  } else {
    description = translate('historyDeleted').replace('{name}', name);
  }

  return description;
}

function renderHistory() {
  var historyList = document.getElementById('history-list');
  var undoButton = document.getElementById('undo-history');
  if (!historyList || !undoButton) return;

  var recentEntries = inventory.history.slice(-20).reverse();
  historyList.innerHTML = recentEntries.map(function (entry) {
    var time = new Date(entry.at).toLocaleTimeString(translate('locale'), {
      hour: '2-digit',
      minute: '2-digit'
    });
    var state = entry.undone
      ? '<small>' + translate('historyUndone') + '</small>'
      : '';
    return '<li class="history-item' + (entry.undone ? ' undone' : '') + '"><span>' +
      formatHistoryEntry(entry) + '</span><small>' + escapeHtml(translate(entry.fridge)) +
      ' · ' + time + '</small>' + state + '</li>';
  }).join('') || '<li class="history-empty">' + translate('historyEmpty') + '</li>';

  undoButton.textContent = translate('historyUndo');
  undoButton.disabled = !inventory.history.some(function (entry) { return !entry.undone; });
}

function findHistoryItemIndex(entry) {
  return inventory[entry.fridge].findIndex(function (item) {
    return item.n === entry.itemName && (item.g || '') === (entry.group || '');
  });
}

function undoLatestChange() {
  var entry = null;
  for (var index = inventory.history.length - 1; index >= 0; index--) {
    if (!inventory.history[index].undone) {
      entry = inventory.history[index];
      break;
    }
  }
  if (!entry) return;

  var productList = inventory[entry.fridge];
  var itemIndex = findHistoryItemIndex(entry);
  if (entry.type === 'add' && itemIndex >= 0) {
    productList.splice(itemIndex, 1);
  } else if (entry.type === 'delete' && itemIndex < 0) {
    productList.splice(Math.min(entry.index, productList.length), 0, entry.item);
  } else if (itemIndex >= 0) {
    var item = productList[itemIndex];
    if (entry.type === 'quantity') {
      item.q = entry.before;
      item.ok = entry.beforeOk;
    } else if (entry.type === 'maximum') {
      item.max = entry.before;
    } else if (entry.type === 'presence') {
      item.ok = entry.before;
    } else if (entry.type === 'shop') {
      item.shop = entry.before;
    }
  } else {
    return;
  }

  entry.undone = true;
  saveInventory();
  renderCategories();
  renderInventory();
  renderHistory();
}

window.renderHistory = renderHistory;
document.getElementById('undo-history').onclick = undoLatestChange;

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, function (character) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[character];
  });
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function getItemShop(item) {
  return item.shop && inventory.shops.indexOf(item.shop) >= 0
    ? item.shop
    : '';
}

// Fridge products have a category; uncategorized additions use the general limit.
function defaultStockLimit(fridgeKey, item) {
  if (fridgeKey === 'stock') return 0;
  if (!item || !item.g) return 6;
  if (fridgeKey === 'bar') return 12;
  if (fridgeKey === 'cuisine') return 1;
  return 6;
}

function getStockLimit(item, fridgeKey) {
  return item.max === undefined || item.max === null
    ? defaultStockLimit(fridgeKey, item)
    : Number(item.max);
}

// Bring older saved quantities in line with the current per-product limits.
function normalizeStockLimits() {
  var changed = false;
  var needsMigration = Number(inventory.stockLimitVersion) < 2;

  fridgeTabs.forEach(function (fridgeTab) {
    var fridgeKey = fridgeTab[0];
    inventory[fridgeKey].forEach(function (item) {
      var needsDefaultLimit = needsMigration && fridgeKey !== 'stock';
      var missingLimit = item.max === undefined || item.max === null;
      if (needsDefaultLimit || missingLimit) {
        item.max = defaultStockLimit(fridgeKey, item);
        changed = true;
      }
    });
  });

  if (needsMigration) {
    inventory.stockLimitVersion = 2;
    changed = true;
  }
  if (changed) saveInventory(true);
}

function getItemsToBuy() {
  var itemsToBuy = [];
  var addedNames = {};

  inventory.stock.forEach(function (item) {
    var level = getStockLevel(item);
    var name = normalizeText(item.n);
    if ((level === 'out' || level === 'low') && !addedNames[name]) {
      addedNames[name] = true;
      itemsToBuy.push(item);
    }
  });

  ['bar', 'cuisine'].forEach(function (fridgeKey) {
    inventory[fridgeKey].forEach(function (item) {
      var level = getStockLevel(item);
      var name = normalizeText(item.n);
      if ((level === 'out' || level === 'low') && !addedNames[name] && !getStockItem(item)) {
        addedNames[name] = true;
        itemsToBuy.push(item);
      }
    });
  });

  return itemsToBuy;
}

function getStockLevel(item) {
  if (!item.ok) return 'out';

  var max = Number(item.max) || 0;
  if (!max) return '';
  if (item.q >= max) return 'full';
  if (item.q * 2 < max) return 'low';
  return 'ok';
}

function getStockItem(item) {
  var name = normalizeText(item.n);
  return inventory.stock.find(function (stockItem) {
    return normalizeText(stockItem.n) === name;
  });
}

function renderStockBadge(item, level) {
  if (activeFridge === 'stock') return '';

  var stockItem = getStockItem(item);
  if (!stockItem) return '';
  if (!stockItem.ok) return '<span class="pill p-out">📦 ' + translate('stockEmpty') + '</span>';
  if (stockItem.q <= 0) return '';

  var warning = level === 'out' || level === 'low';
  var warningText = warning ? ' · ' + translate('stockTake') : '';
  return '<span class="pill p-' + (getStockLevel(stockItem) === 'low' ? 'low' : 'ok') + '">📦 ' +
    translate('stockQuantity').replace('{count}', stockItem.q) + warningText + '</span>';
}

function updateActiveFridgeTab() {
  document.querySelectorAll('.tab').forEach(function (button) {
    button.classList.toggle('on', button.dataset.t === activeFridge);
  });
}

// Render counts and matching products together so every product is visited once.
function renderInventory() {
  var products = inventory[activeFridge];
  var query = normalizeText(searchByFridge[activeFridge]);
  var statusCounts = { out: 0, low: 0, ok: 0, full: 0, '': 0 };
  var exactMatchFound = false;
  var productRows = '';
  var visibleProductCount = 0;
  var previousGroup = null;

  products.forEach(function (item, index) {
    var level = getStockLevel(item);
    statusCounts[level]++;

    var normalizedName = query ? normalizeText(item.n) : '';
    if (query && normalizedName === query) exactMatchFound = true;
    if (query && normalizedName.indexOf(query) < 0) return;

    visibleProductCount++;
    var group = item.g || '';
    var shop = getItemShop(item);
    var progress = item.max > 0
      ? Math.max(0, Math.min(100, Math.round(item.q / item.max * 100)))
      : 0;

    if (group !== previousGroup) {
      if (group || previousGroup !== null) {
        productRows += '<div class="g">' + escapeHtml(group || translate('other')) + '</div>';
      }
      previousGroup = group;
    }

    var rowState = level === 'out' ? ' ko' : (level === 'low' ? ' lw' : '');
    productRows += '<div class="item' + rowState + '">';
    productRows += '<button class="ck' + (item.ok ? ' on' : '') + '" data-k="' + index + '" aria-label="' + translate('presentAria') + '">';
    productRows += item.ok ? '✓' : '';
    productRows += '</button><div class="nm"><span class="n">' + escapeHtml(item.n) + '</span><div class="tags">';
    productRows += '<button class="shop' + (shop ? '' : ' no') + '" data-s="' + index + '">🏪 ';
    productRows += escapeHtml(shop || translate('storeUnknown')) + '</button>';
    if (level) {
      productRows += '<span class="pill p-' + level + '">' + translate('level' + level.charAt(0).toUpperCase() + level.slice(1)) + '</span>';
    }
    productRows += renderStockBadge(item, level) + '</div>';
    if (item.max > 0) productRows += '<div class="pg"><i style="width:' + progress + '%"></i></div>';
    productRows += '</div>';
    productRows += '<div class="q"><button data-m="' + index + '" aria-label="' + translate('less') + '">−</button>';
    productRows += '<input class="qi" type="text" inputmode="numeric" data-i="' + index + '" value="' + item.q + '" aria-label="' + translate('quantity') + '">';
    productRows += '<span class="sl">/</span><input class="mx" type="text" inputmode="numeric" data-i="' + index + '" value="' + (item.max > 0 ? item.max : '') + '" placeholder="max" aria-label="' + translate('maximum') + '">';
    productRows += '<button data-p="' + index + '" aria-label="' + translate('more') + '">+</button></div>';
    productRows += '<button class="x" data-d="' + index + '" aria-label="' + translate('delete') + '">×</button></div>';
  });

  var availableCount = statusCounts.ok + statusCounts.full + statusCounts[''];
  var html = '<div class="sum"><div><b style="color:var(--ok)">';
  html += availableCount + '</b>' + translate('levelOk') + '</div><div><b style="color:var(--low)">';
  html += statusCounts.low + '</b>' + translate('levelLow') + '</div><div><b style="color:var(--out)">';
  html += statusCounts.out + '</b>' + translate('levelOut') + '</div></div>';

  if (query && !exactMatchFound) {
    html += '<button class="btn addrow" data-a="1">';
    html += translate('addProduct').replace('{name}', escapeHtml(searchByFridge[activeFridge].trim()));
    html += ' · 📂 ' + escapeHtml(getCategoryLabel());
    html += '</button>';
  }

  html += productRows;
  if (!visibleProductCount) html += '<div class="none">' + translate('noResults') + '</div>';
  inventoryBody.innerHTML = html;

  updateActiveFridgeTab();

  var itemsToBuy = getItemsToBuy();
  var shoppingMessage = translate('shoppingEmpty');
  if (itemsToBuy.length) {
    var countKey = itemsToBuy.length === 1 ? 'shoppingItemsOne' : 'shoppingItemsMany';
    shoppingMessage = translate(countKey).replace('{count}', itemsToBuy.length);
    shoppingMessage += translate('shoppingOnly');
  }

  document.getElementById('sc').innerHTML = translate('shoppingList') +
    '<small>' + shoppingMessage + '</small>';
}

function renderShops() {
  var shopChips = inventory.shops.map(function (shop, index) {
    return '<span class="chip">' + escapeHtml(shop) +
      '<button data-ds="' + index + '" aria-label="' + translate('delete') + '">×</button></span>';
  }).join('');

  document.getElementById('chips').innerHTML = shopChips ||
    '<span class="hint">' + translate('noStores') + '</span>';
}

function getCategories() {
  var categories = [];
  inventory[activeFridge].forEach(function (item) {
    if (item.g && categories.indexOf(item.g) < 0) categories.push(item.g);
  });
  return categories;
}

function getCategoryLabel() {
  if (categorySelect.value === '__new') {
    return newCategoryInput.value.trim() || translate('newCategory');
  }
  return categorySelect.value || translate('other');
}

function renderCategories(selectedCategory) {
  var previousSelection = selectedCategory === undefined
    ? categorySelect.value
    : selectedCategory;
  var options = getCategories().map(function (category) {
    return '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>';
  }).join('');

  options += '<option value="">' + translate('other') + '</option>';
  options += '<option value="__new">➕ ' + translate('newCategory') + '</option>';
  categorySelect.innerHTML = options;
  categorySelect.value = previousSelection;
  if (categorySelect.value !== previousSelection) categorySelect.value = '';
  newCategoryInput.style.display = categorySelect.value === '__new' ? 'block' : 'none';
}

categorySelect.onchange = function () {
  renderCategories(categorySelect.value);
  if (categorySelect.value === '__new') newCategoryInput.focus();
  renderInventory();
};

newCategoryInput.oninput = renderInventory;
newCategoryInput.onkeydown = function (event) {
  if (event.key === 'Enter') {
    addItem();
    newCategoryInput.blur();
  }
};

function addItem() {
  var name = searchByFridge[activeFridge].trim();
  var group = categorySelect.value;
  var alreadyExists = inventory[activeFridge].some(function (item) {
    return normalizeText(item.n) === normalizeText(name);
  });

  if (!name || alreadyExists) return;

  if (group === '__new') {
    group = newCategoryInput.value.trim();
    if (!group) {
      newCategoryInput.focus();
      return;
    }

    var matchingCategory = getCategories().find(function (category) {
      return normalizeText(category) === normalizeText(group);
    });
    group = matchingCategory || group.charAt(0).toUpperCase() + group.slice(1);
  }

  var item = {
    n: name.charAt(0).toUpperCase() + name.slice(1),
    g: group,
    q: 0,
    max: defaultStockLimit(activeFridge, { g: group }),
    ok: false,
    shop: ''
  };
  var productList = inventory[activeFridge];
  var lastItemInGroup = -1;
  productList.forEach(function (existingItem, index) {
    if ((existingItem.g || '') === group) lastItemInGroup = index;
  });
  productList.splice(lastItemInGroup + 1, 0, item);
  recordHistory({
    type: 'add',
    fridge: activeFridge,
    itemName: item.n,
    group: item.g || '',
    index: lastItemInGroup + 1,
    item: JSON.parse(JSON.stringify(item))
  });

  searchByFridge[activeFridge] = '';
  searchInput.value = '';
  newCategoryInput.value = '';
  saveInventory();
  renderCategories(group);
  renderInventory();
}

// Delegate row actions from the inventory container instead of binding every button.
inventoryBody.onclick = function (event) {
  var button = event.target.closest('button');
  if (!button) return;

  var productList = inventory[activeFridge];
  var action = button.dataset;
  var item;

  if (action.a) {
    addItem();
    return;
  }

  if (action.k !== undefined) {
    item = productList[Number(action.k)];
    var previousPresence = item.ok;
    item.ok = !item.ok;
    recordHistory({
      type: 'presence', fridge: activeFridge, itemName: item.n,
      group: item.g || '', before: previousPresence, after: item.ok
    });
  } else if (action.p !== undefined) {
    item = productList[Number(action.p)];
    var previousPlusQuantity = item.q;
    var previousPlusPresence = item.ok;
    item.q = Math.min(item.q + 1, 9999);
    item.ok = item.q > 0;
    if (item.q !== previousPlusQuantity) {
      recordHistory({
        type: 'quantity', fridge: activeFridge, itemName: item.n,
        group: item.g || '', before: previousPlusQuantity, after: item.q,
        beforeOk: previousPlusPresence
      });
    }
  } else if (action.m !== undefined) {
    item = productList[Number(action.m)];
    var previousMinusQuantity = item.q;
    var previousMinusPresence = item.ok;
    if (item.q > 0) item.q--;
    if (item.q === 0) item.ok = false;
    if (item.q !== previousMinusQuantity) {
      recordHistory({
        type: 'quantity', fridge: activeFridge, itemName: item.n,
        group: item.g || '', before: previousMinusQuantity, after: item.q,
        beforeOk: previousMinusPresence
      });
    }
  } else if (action.s !== undefined) {
    item = productList[Number(action.s)];
    var previousShop = item.shop || '';
    var currentShopIndex = inventory.shops.indexOf(getItemShop(item));
    item.shop = currentShopIndex + 1 < inventory.shops.length
      ? inventory.shops[currentShopIndex + 1]
      : '';
    if (item.shop !== previousShop) {
      recordHistory({
        type: 'shop', fridge: activeFridge, itemName: item.n,
        group: item.g || '', before: previousShop, after: item.shop
      });
    }
  } else if (action.d !== undefined) {
    var deletedIndex = Number(action.d);
    item = productList[deletedIndex];
    productList.splice(deletedIndex, 1);
    recordHistory({
      type: 'delete', fridge: activeFridge, itemName: item.n,
      group: item.g || '', index: deletedIndex,
      item: JSON.parse(JSON.stringify(item))
    });
  } else {
    return;
  }

  saveInventory();
  renderInventory();
};

inventoryBody.addEventListener('focusin', function (event) {
  if (event.target.classList.contains('qi') || event.target.classList.contains('mx')) {
    var item = inventory[activeFridge][Number(event.target.dataset.i)];
    var isMaximum = event.target.classList.contains('mx');
    event.target.dataset.historyBefore = isMaximum ? item.max : item.q;
    event.target.dataset.historyBeforeOk = item.ok;
    event.target.select();
  }
});

// Quantities and maxima can both be edited directly from a product row.
function updateQuantityInput(event) {
  var isQuantity = event.target.classList.contains('qi');
  var isMaximum = event.target.classList.contains('mx');
  if (!isQuantity && !isMaximum) return false;

  var item = inventory[activeFridge][Number(event.target.dataset.i)];
  var value = parseInt(String(event.target.value).replace(/\D/g, ''), 10);
  if (isMaximum) {
    item.max = isNaN(value) ? 0 : Math.min(value, 9999);
  } else {
    item.q = isNaN(value) ? 0 : Math.min(value, 9999);
    item.ok = item.q > 0;
  }

  return true;
}

inventoryBody.addEventListener('input', function (event) {
  if (!updateQuantityInput(event)) return;
  inventory.updated = Date.now();
  inventory.dirty = true;
  saveInventory(true);
});

inventoryBody.addEventListener('change', function (event) {
  if (!updateQuantityInput(event)) return;

  var isMaximum = event.target.classList.contains('mx');
  var item = inventory[activeFridge][Number(event.target.dataset.i)];
  var previousValue = Number(event.target.dataset.historyBefore);
  var currentValue = isMaximum ? item.max : item.q;
  if (!isFinite(previousValue)) previousValue = currentValue;
  if (previousValue !== currentValue) {
    recordHistory({
      type: isMaximum ? 'maximum' : 'quantity',
      fridge: activeFridge,
      itemName: item.n,
      group: item.g || '',
      before: previousValue,
      after: currentValue,
      beforeOk: event.target.dataset.historyBeforeOk === 'true'
    });
  }

  saveInventory();
  renderInventory();
});

inventoryBody.addEventListener('keydown', function (event) {
  var isQuantity = event.target.classList.contains('qi');
  var isMaximum = event.target.classList.contains('mx');
  if (event.key === 'Enter' && (isQuantity || isMaximum)) {
    event.target.blur();
  }
});

searchInput.oninput = function () {
  searchByFridge[activeFridge] = searchInput.value;
  renderInventory();
};

searchInput.onkeydown = function (event) {
  if (event.key === 'Enter') {
    addItem();
    searchInput.blur();
  }
};

document.querySelectorAll('.tab').forEach(function (button) {
  button.onclick = function () {
    activeFridge = button.dataset.t;
    updateActiveFridgeTab();
    searchInput.value = searchByFridge[activeFridge];
    newCategoryInput.value = '';
    renderCategories('');
    renderInventory();
  };
});

document.getElementById('chips').onclick = function (event) {
  var button = event.target.closest('button');
  if (!button) return;

  var removedShop = inventory.shops.splice(Number(button.dataset.ds), 1)[0];
  fridgeTabs.forEach(function (fridgeTab) {
    inventory[fridgeTab[0]].forEach(function (item) {
      if (item.shop === removedShop) item.shop = '';
    });
  });

  saveInventory();
  renderShops();
  renderInventory();
};

function addShop() {
  var input = document.getElementById('ns');
  var name = input.value.trim();
  var alreadyExists = inventory.shops.some(function (shop) {
    return normalizeText(shop) === normalizeText(name);
  });

  if (!name || alreadyExists) return;

  inventory.shops.push(name);
  input.value = '';
  saveInventory();
  renderShops();
  renderInventory();
}

document.getElementById('nsb').onclick = addShop;
document.getElementById('ns').onkeydown = function (event) {
  if (event.key === 'Enter') addShop();
};

var phoneInput = document.getElementById('tel');
phoneInput.value = inventory.tel || '';
phoneInput.onchange = function () {
  inventory.tel = phoneInput.value.replace(/\D/g, '');
  saveInventory();
};

function formatDate() {
  return new Date().toLocaleDateString(translate('locale'), {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function openWhatsApp(message) {
  var phoneNumber = (inventory.tel || '').replace(/\D/g, '');
  var link = document.createElement('a');
  link.href = 'https://wa.me/' + phoneNumber + '?text=' + encodeURIComponent(message);
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function sendShoppingList() {
  var itemsToBuy = getItemsToBuy();
  var message = translate('waShoppingTitle') + '\n' + formatDate() + '\n';

  if (!itemsToBuy.length) {
    openWhatsApp(message + '\n' + translate('nothingToBuy'));
    return;
  }

  // Group each item under its assigned shop; unassigned items go in the final group.
  inventory.shops.concat(['']).forEach(function (shop) {
    var shopItems = itemsToBuy.filter(function (item) {
      return getItemShop(item) === shop;
    });
    if (!shopItems.length) return;

    message += '\n🏪 *' + (shop ? shop.toUpperCase() : translate('noStore')) + '*\n';
    shopItems.forEach(function (item) {
      var remaining = '';
      if (item.q > 0 && item.max > 0) {
        remaining = ' — ' + translate('remainingWithMax')
          .replace('{count}', item.q)
          .replace('{max}', item.max);
      } else if (item.q > 0) {
        remaining = ' (' + translate('remaining').replace('{count}', item.q) + ')';
      }
      message += '• ' + item.n + remaining + '\n';
    });
  });

  var totalKey = itemsToBuy.length === 1 ? 'totalOne' : 'totalMany';
  message += '\n' + translate(totalKey).replace('{count}', itemsToBuy.length);
  openWhatsApp(message);
}

document.getElementById('sc').onclick = sendShoppingList;

function sendInventory() {
  var message = translate('inventoryTitle') + '\n' + formatDate() + '\n';

  fridgeTabs.forEach(function (fridgeTab) {
    var fridgeName = fridgeTab[0];
    var products = inventory[fridgeName];
    var outOfStock = products.filter(function (item) { return getStockLevel(item) === 'out'; });
    var lowStock = products.filter(function (item) { return getStockLevel(item) === 'low'; });
    var available = products.filter(function (item) {
      var level = getStockLevel(item);
      return level !== 'out' && level !== 'low';
    });

    message += '\n' + translate(fridgeName).toUpperCase() + '\n';
    message += translate('inventoryStats')
      .replace('{ok}', available.length)
      .replace('{low}', lowStock.length)
      .replace('{out}', outOfStock.length) + '\n';

    if (available.length) {
      message += '\n' + translate('levelOk') + '\n' + formatItemLines(available);
    }
    if (lowStock.length) {
      message += '\n' + translate('levelLow') + '\n' + formatItemLines(lowStock);
    }
    if (outOfStock.length) {
      message += '\n' + translate('levelOut') + '\n' + formatItemLines(outOfStock);
    }
  });

  openWhatsApp(message.replace(/\s+$/, ''));
}

document.getElementById('si').onclick = sendInventory;

function formatItemLines(items) {
  var message = '';
  var previousGroup = null;

  items.forEach(function (item) {
    var group = item.g || '';
    if (group && group !== previousGroup) message += '_' + group + '_\n';
    previousGroup = group;

    var quantity = item.max > 0
      ? '*' + item.q + ' / ' + item.max + '*'
      : (item.q > 0 ? '*' + item.q + '*' : '✓');
    message += '• ' + item.n + ' : ' + quantity + '\n';
  });

  return message;
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = translate('appTitle');
  document.querySelector('h1').childNodes[0].nodeValue = translate('heading') + ' ';
  document.getElementById('history-summary').textContent = translate('historyTitle');
  document.getElementById('lang-label').textContent = translate('language');

  document.querySelectorAll('.tab').forEach(function (button) {
    button.textContent = translate(button.dataset.t);
  });

  searchInput.placeholder = translate('searchPlaceholder');
  document.querySelector('.hint').textContent = translate('hint');
  categorySelect.setAttribute('aria-label', translate('category'));
  newCategoryInput.placeholder = translate('newCategoryPlaceholder');

  document.getElementById('shops-summary').textContent = translate('shops');
  document.getElementById('whatsapp-summary').textContent = translate('whatsappSettings');
  document.getElementById('ns').placeholder = translate('newShop');
  phoneInput.placeholder = translate('phonePlaceholder');
  document.querySelector('.send .lab').textContent = translate('send');
  document.getElementById('si').innerHTML = translate('inventoryButton') +
    '<small>' + translate('inventoryDescription') + '</small>';

  renderShops();
  renderCategories();
  renderInventory();
  renderHistory();
  setSyncStatus(syncStatusKey);
}

function setSyncStatus(key) {
  syncStatusKey = key;
  document.getElementById('sync').textContent = translate(key);
}

var languageSelect = document.getElementById('lang');
languageSelect.value = language;
languageSelect.onchange = function () {
  language = LANGUAGE_TEXTS[languageSelect.value] ? languageSelect.value : 'fr';
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (error) {}
  applyLanguage();
};

renderCategories('');
applyLanguage();

// Keep the local inventory usable if the cloud service cannot be reached.
window.setTimeout(function () {
  if (document.body.classList.contains('loading')) {
    document.body.classList.remove('loading');
    setSyncStatus('offline');
  }
}, 5000);
