import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getDatabase, onValue, ref, set } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js';

// This is the Firebase project configuration supplied with the reference app.
var firebaseConfig = {
  apiKey: 'AIzaSyCzChWIlP2_7EGKxVwTQqngoM3xV4IMPCo',
  authDomain: 'hostel-stock-dealer.firebaseapp.com',
  databaseURL: 'https://hostel-stock-dealer-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'hostel-stock-dealer',
  storageBucket: 'hostel-stock-dealer.firebasestorage.app',
  messagingSenderId: '171257531477',
  appId: '1:171257531477:web:ac701178e4ecdec95398dc'
};

var inventoryKey = 'frigos-hotel-v3';
var syncReady = false;
var firstSnapshot = true;
var databaseRef;

function setStatus(key) {
  if (window.setSyncStatus) window.setSyncStatus(key);
}

function finishLoading() {
  document.body.classList.remove('loading');
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value).sort(function (left, right) {
    return Number(left) - Number(right);
  }).map(function (key) {
    return value[key];
  });
}

function applyRemoteInventory(remoteData) {
  var hasRemoteStock = remoteData.stock !== undefined && remoteData.stock !== null;
  var needsLimitMigration = Number(remoteData.stockLimitVersion) < 2;
  var needsOrderMigration = !window.isValidFridgeOrder(remoteData.fridgeOrder);
  var updatedInventory = {
    bar: normalizeList(remoteData.bar),
    cuisine: normalizeList(remoteData.cuisine),
    stock: hasRemoteStock ? normalizeList(remoteData.stock) : [],
    shops: normalizeList(remoteData.shops),
    history: normalizeList(remoteData.history),
    fridgeOrder: needsOrderMigration
      ? window.inventory.fridgeOrder.slice()
      : remoteData.fridgeOrder.slice(),
    updated: remoteData.updated || 0,
    stockLimitVersion: Number(remoteData.stockLimitVersion) || 0,
    dirty: false
  };

  // Older cloud records have no reserve list, so build one without changing fridge counts.
  if (!hasRemoteStock) {
    updatedInventory.stock = updatedInventory.bar.concat(updatedInventory.cuisine).map(function (item) {
      return {
        n: item.n,
        g: item.g,
        q: 0,
        max: 0,
        ok: true,
        shop: item.shop || ''
      };
    });
  }

  if (!updatedInventory.shops.length) {
    updatedInventory.shops = ['Metro', 'La Vie Claire'];
  }

  window.inventory = updatedInventory;
  window.applyRemoteFridgeOrder(updatedInventory.fridgeOrder);
  window.normalizeStockLimits();
  if (needsLimitMigration || needsOrderMigration) {
    window.inventory.updated = Date.now();
    window.inventory.dirty = true;
  }

  try {
    localStorage.setItem(inventoryKey, JSON.stringify(window.inventory));
  } catch (error) {}

  window.renderShops();
  window.renderCategories('');
  window.renderInventory();
  window.renderHistory();
}

function saveRemoteInventory() {
  if (!syncReady) return;

  var payload = JSON.parse(JSON.stringify(window.inventory));
  var sentAt = window.inventory.updated;
  delete payload.dirty;
  setStatus('syncSaving');

  set(databaseRef, payload).then(function () {
    if (window.inventory.updated === sentAt) {
      window.inventory.dirty = false;
      try {
        localStorage.setItem(inventoryKey, JSON.stringify(window.inventory));
      } catch (error) {}
    }
    setStatus('syncSynced');
  }).catch(function (error) {
    setStatus('syncError');
    console.error('Firebase sync failed:', error);
  });
}

window.cloudSave = saveRemoteInventory;

try {
  var app = initializeApp(firebaseConfig);
  var database = getDatabase(app);
  databaseRef = ref(database, 'hotel/state');

  onValue(databaseRef, function (snapshot) {
    var remoteData = snapshot.val();
    var localUpdated = window.inventory.updated || 0;
    var remoteUpdated = remoteData && remoteData.updated ? remoteData.updated : 0;

    if (firstSnapshot) {
      firstSnapshot = false;
      syncReady = true;
      finishLoading();

      if (!remoteData) {
        window.inventory.updated = Date.now();
        window.inventory.dirty = true;
        saveRemoteInventory();
      } else if (window.inventory.dirty || localUpdated > remoteUpdated) {
        saveRemoteInventory();
      } else {
        applyRemoteInventory(remoteData);
        if (window.inventory.dirty) saveRemoteInventory();
        else setStatus('syncSynced');
      }
      return;
    }

    if (remoteData && remoteUpdated !== localUpdated && !window.inventory.dirty) {
      applyRemoteInventory(remoteData);
      if (window.inventory.dirty) saveRemoteInventory();
      else setStatus('syncSynced');
      return;
    }
    setStatus('syncSynced');
  }, function (error) {
    finishLoading();
    setStatus('syncDenied');
    console.error('Firebase read failed:', error);
  });

  window.addEventListener('online', saveRemoteInventory);
} catch (error) {
  finishLoading();
  setStatus('syncOffline');
  console.error('Firebase is unavailable:', error);
}
