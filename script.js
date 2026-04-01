import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyClhb_-h8A25NcRkt7q-Jm15HkIQX2NoEs",
    authDomain: "kiui-3527b.firebaseapp.com",
    projectId: "kiui-3527b",
    storageBucket: "kiui-3527b.firebasestorage.app",
    messagingSenderId: "174501891120",
    appId: "1:174501891120:web:aa6a83eb7c776f88aa71f5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentInventory = 1;
let currentRentInventory = 1; 
let currentCustomerId = null;
let isOnline = navigator.onLine;

let data = {
    inventory1: [],
    inventory2: [],
    customers: [],
    transactions: [],
    lastSync: 0
};

let syncQueue = [];

const DB_NAME = 'kareemDB';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('store')) {
                db.createObjectStore('store');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getLocalData(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readonly');
        const store = tx.objectStore('store');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function setLocalData(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        const store = tx.objectStore('store');
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function initData() {
    const localData = await getLocalData('kareemData');
    const localQueue = await getLocalData('syncQueue');
    if (localData) data = localData;
    if (localQueue) syncQueue = localQueue;
    
    if (isOnline) {
        await processQueue();
        await syncData();
    } else {
        updateNetworkStatus('offline');
        renderUI();
    }
}

async function saveDataLocally() {
    data.lastUpdated = Date.now();
    await setLocalData('kareemData', data);
    if (isOnline) {
        await processQueue();
    }
}

function addToQueue(action, collection, item) {
    syncQueue.push({ 
        id: Date.now() + Math.random(), 
        action: action, 
        collection: collection, 
        item: JSON.parse(JSON.stringify(item)), 
        timestamp: Date.now() 
    });
    setLocalData('syncQueue', syncQueue);
}

async function processQueue() {
    if (!isOnline || syncQueue.length === 0) return;
    updateNetworkStatus('syncing');
    try {
        const docRef = doc(db, "data", "main");
        const docSnap = await getDoc(docRef);
        let serverData = { inventory1: [], inventory2: [], customers: [], transactions: [] };
        
        if (docSnap.exists()) {
            serverData = docSnap.data();
        }

        for (const op of syncQueue) {
            if (!serverData[op.collection]) serverData[op.collection] = [];
            
            if (op.action === 'add') {
                const exists = serverData[op.collection].find(x => x.id === op.item.id);
                if (!exists) {
                    serverData[op.collection].push(op.item);
                } else {
                     const idx = serverData[op.collection].findIndex(x => x.id === op.item.id);
                     if(op.item.lastUpdated > serverData[op.collection][idx].lastUpdated) {
                          serverData[op.collection][idx] = op.item;
                     }
                }
            } else if (op.action === 'edit') {
                const idx = serverData[op.collection].findIndex(x => x.id === op.item.id);
                if (idx > -1) {
                    if(!serverData[op.collection][idx].lastUpdated || op.item.lastUpdated > serverData[op.collection][idx].lastUpdated) {
                        serverData[op.collection][idx] = op.item;
                    }
                } else {
                    serverData[op.collection].push(op.item);
                }
            } else if (op.action === 'delete') {
                serverData[op.collection] = serverData[op.collection].filter(x => x.id !== op.item.id);
            }
        }

        await setDoc(docRef, serverData);
        syncQueue = [];
        await setLocalData('syncQueue', syncQueue);
        
        mergeData(serverData);
        updateNetworkStatus('online');
        renderUI();
    } catch (e) {
        console.error(e);
        updateNetworkStatus('offline');
    }
}

async function syncData() {
    if (syncQueue.length > 0) {
        await processQueue();
        return;
    }
    updateNetworkStatus('syncing');
    try {
        const docRef = doc(db, "data", "main");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const serverData = docSnap.data();
            mergeData(serverData);
        }
        
        updateNetworkStatus('online');
        renderUI();
    } catch (e) {
        updateNetworkStatus('offline');
    }
}

function mergeData(serverData) {
    const mergeArray = (localArr, serverArr) => {
        const map = new Map();
        if(serverArr) serverArr.forEach(item => map.set(item.id, item));
        if(localArr) localArr.forEach(item => {
            if (!map.has(item.id) || (item.lastUpdated && map.get(item.id).lastUpdated && item.lastUpdated > map.get(item.id).lastUpdated)) {
                map.set(item.id, item);
            }
        });
        return Array.from(map.values());
    };

    data.inventory1 = mergeArray(data.inventory1 || [], serverData.inventory1 || []);
    data.inventory2 = mergeArray(data.inventory2 || [], serverData.inventory2 || []);
    data.customers = mergeArray(data.customers || [], serverData.customers || []);
    data.transactions = mergeArray(data.transactions || [], serverData.transactions || []);
    data.lastSync = Date.now();
    setLocalData('kareemData', data);
}

function updateNetworkStatus(status) {
    const el = document.getElementById('network-status');
    el.className = `network-status ${status}`;
    if (status === 'online') el.innerText = 'متصل';
    if (status === 'offline') el.innerText = 'غير متصل';
    if (status === 'syncing') el.innerText = 'جاري المزامنة...';
}

window.addEventListener('online', () => { isOnline = true; processQueue(); });
window.addEventListener('offline', () => { isOnline = false; updateNetworkStatus('offline'); });

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js');
        // إظهار زر التثبيت فوراً عند تحميل الصفحة
        document.getElementById('install-prompt').style.display = 'block';
    });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-prompt').style.display = 'block';
});

window.installApp = function() {
    document.getElementById('install-prompt').style.display = 'none';
    if(deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
    }
};

window.closeInstallPrompt = function() {
    document.getElementById('install-prompt').style.display = 'none';
};

function formatIQD(number) {
    return new Intl.NumberFormat('en-IQ').format(number);
}

window.checkPassword = function() {
    const pass = document.getElementById('password-input').value;
    if (pass === "1001") {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('main-app').classList.add('active');
        window.switchTab('tab-customers'); 
    } else {
        alert("كلمة المرور خاطئة");
    }
}

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    document.getElementById(tabId.replace('tab-', 'nav-')).classList.add('active');

    if(tabId === 'tab-inventory') {
        document.getElementById('search-inventory').value = '';
        window.renderInventory();
    }
    if(tabId === 'tab-customers') {
        document.getElementById('search-customer').value = '';
        document.getElementById('customers-main-view').style.display = 'block';
        document.getElementById('customer-details-view').style.display = 'none';
        window.renderCustomers();
    }
    if(tabId === 'tab-alerts') window.renderAlerts();
}

window.openModal = function(modalId) {
    document.getElementById(modalId).classList.add('active');
}
window.closeModal = function(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

window.switchInventory = function(num) {
    currentInventory = num;
    document.getElementById('btn-inv-1').classList.remove('active');
    document.getElementById('btn-inv-2').classList.remove('active');
    document.getElementById(`btn-inv-${num}`).classList.add('active');
    document.getElementById('current-inv-label').innerText = num;
    document.getElementById('search-inventory').value = ''; 
    window.renderInventory();
}

window.saveItem = async function() {
    const name = document.getElementById('item-name').value;
    const price = parseFloat(document.getElementById('item-price').value);
    const qty = parseInt(document.getElementById('item-qty').value);

    if (!name || isNaN(price) || isNaN(qty)) {
        alert("يرجى تعبئة جميع الحقول بشكل صحيح"); return;
    }

    const newItem = { id: Date.now(), name, price, qty, lastUpdated: Date.now() };
    const collection = currentInventory === 1 ? 'inventory1' : 'inventory2';
    
    data[collection].push(newItem);
    addToQueue('add', collection, newItem);

    await saveDataLocally();
    window.closeModal('addItemModal');
    
    document.getElementById('item-name').value = '';
    document.getElementById('item-price').value = '';
    document.getElementById('item-qty').value = '';
    
    window.searchInventory();
}

window.searchInventory = function() {
    const query = document.getElementById('search-inventory').value.toLowerCase().trim();
    window.renderInventory(query);
}

window.openEditModal = function(id, invNum) {
    const items = invNum === 1 ? data.inventory1 : data.inventory2;
    const item = items.find(i => i.id === id);

    if (item) {
        document.getElementById('edit-item-id').value = id;
        document.getElementById('edit-item-inv').value = invNum;
        document.getElementById('edit-item-name').value = item.name;
        document.getElementById('edit-item-price').value = item.price;
        document.getElementById('edit-item-qty').value = item.qty;
        
        window.openModal('editItemModal');
    }
}

window.saveEditItem = async function() {
    const id = parseInt(document.getElementById('edit-item-id').value);
    const invNum = parseInt(document.getElementById('edit-item-inv').value);
    const name = document.getElementById('edit-item-name').value;
    const price = parseFloat(document.getElementById('edit-item-price').value);
    const qty = parseInt(document.getElementById('edit-item-qty').value);

    if (!name || isNaN(price) || isNaN(qty)) {
        alert("يرجى تعبئة جميع الحقول بشكل صحيح"); return;
    }

    const collection = invNum === 1 ? 'inventory1' : 'inventory2';
    const items = data[collection];
    const itemIndex = items.findIndex(i => i.id === id);

    if (itemIndex > -1) {
        items[itemIndex].name = name;
        items[itemIndex].price = price;
        items[itemIndex].qty = qty;
        items[itemIndex].lastUpdated = Date.now();
        
        addToQueue('edit', collection, items[itemIndex]);
        await saveDataLocally();
        window.closeModal('editItemModal');
        window.searchInventory();
    }
}

window.deleteItem = async function(id, invNum) {
    if(confirm("هل أنت متأكد من حذف هذه المادة؟")) {
        const collection = invNum === 1 ? 'inventory1' : 'inventory2';
        data[collection] = data[collection].filter(i => i.id !== id);
        addToQueue('delete', collection, { id: id });
        await saveDataLocally();
        window.searchInventory();
    }
}

window.renderInventory = function(searchQuery = '') {
    const list = document.getElementById('inventory-list');
    list.innerHTML = '';
    let items = currentInventory === 1 ? data.inventory1 : data.inventory2;

    if (searchQuery) {
        items = items.filter(item => item.name.toLowerCase().startsWith(searchQuery));
    }

    if(items.length === 0 && searchQuery !== '') {
        list.innerHTML = '<p style="text-align:center; color:#7f8c8d; padding: 20px;">لا توجد مواد تطابق بحثك.</p>';
        return;
    }

    items.forEach(item => {
        list.innerHTML += `
            <div class="card">
                <div class="card-info">
                    <h4>${item.name}</h4>
                    <p>السعر: ${formatIQD(item.price)} د.ع</p>
                    <p>الكمية المتوفرة: ${item.qty}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-warning btn-small" onclick="window.openEditModal(${item.id}, ${currentInventory})">تعديل</button>
                    <button class="btn-danger btn-small" onclick="window.deleteItem(${item.id}, ${currentInventory})">حذف</button>
                </div>
            </div>
        `;
    });
}

window.searchCustomer = function() {
    const query = document.getElementById('search-customer').value.toLowerCase().trim();
    window.renderCustomers(query);
}

window.saveCustomer = async function() {
    const name = document.getElementById('cust-name').value;
    const phone = document.getElementById('cust-phone').value;

    if (!name || !phone) { alert("يرجى إدخال الاسم والرقم"); return; }

    const newCustomer = {
        id: Date.now(),
        name: name,
        phone: "964" + phone,
        balance: 0,
        lastUpdated: Date.now()
    };

    data.customers.push(newCustomer);
    addToQueue('add', 'customers', newCustomer);

    await saveDataLocally();
    window.closeModal('addCustomerModal');
    
    document.getElementById('cust-name').value = '';
    document.getElementById('cust-phone').value = '';
    
    window.searchCustomer();
}

window.openEditCustomerModal = function(id) {
    const customer = data.customers.find(c => c.id === id);
    if (customer) {
        document.getElementById('edit-cust-id').value = customer.id;
        document.getElementById('edit-cust-name').value = customer.name;
        document.getElementById('edit-cust-phone').value = customer.phone.replace(/^964/, ''); 
        
        window.openModal('editCustomerModal');
    }
}

window.saveEditCustomer = async function() {
    const id = parseInt(document.getElementById('edit-cust-id').value);
    const name = document.getElementById('edit-cust-name').value;
    const phone = document.getElementById('edit-cust-phone').value;

    if (!name || !phone) { alert("يرجى إدخال الاسم والرقم"); return; }

    const customerIndex = data.customers.findIndex(c => c.id === id);
    if (customerIndex > -1) {
        data.customers[customerIndex].name = name;
        data.customers[customerIndex].phone = "964" + phone;
        data.customers[customerIndex].lastUpdated = Date.now();
        
        addToQueue('edit', 'customers', data.customers[customerIndex]);

        await saveDataLocally();
        window.closeModal('editCustomerModal');
        window.searchCustomer();
    }
}

window.renderCustomers = function(searchQuery = '') {
    const list = document.getElementById('customers-list');
    list.innerHTML = '';
    
    let filteredCustomers = data.customers;
    if(searchQuery) {
        filteredCustomers = filteredCustomers.filter(cust => cust.name.toLowerCase().startsWith(searchQuery));
    }

    filteredCustomers.forEach(cust => {
        list.innerHTML += `
            <div class="card" onclick="window.openCustomerDetails(${cust.id})">
                <div class="card-info">
                    <h4>${cust.name}</h4>
                    <p>الرقم: +${cust.phone}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-warning btn-small" onclick="event.stopPropagation(); window.openEditCustomerModal(${cust.id})">تعديل</button>
                    <button class="btn-danger btn-small" onclick="event.stopPropagation(); window.deleteCustomer(${cust.id})">حذف</button>
                </div>
            </div>
        `;
    });
}

window.deleteCustomer = async function(id) {
    if(confirm("هل أنت متأكد من حذف هذا الزبون؟")) {
        data.customers = data.customers.filter(c => c.id !== id);
        addToQueue('delete', 'customers', { id: id });
        await saveDataLocally();
        window.searchCustomer();
    }
}

window.openCustomerDetails = function(id) {
    currentCustomerId = id;
    const customer = data.customers.find(c => c.id === id);
    
    document.getElementById('customers-main-view').style.display = 'none';
    document.getElementById('customer-details-view').style.display = 'block';
    
    document.getElementById('detail-customer-name').innerText = customer.name;
    document.getElementById('detail-customer-phone').innerText = "+" + customer.phone;
    document.getElementById('detail-customer-phone').href = "tel:+" + customer.phone;

    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
}

window.backToCustomers = function() {
    document.getElementById('customers-main-view').style.display = 'block';
    document.getElementById('customer-details-view').style.display = 'none';
    currentCustomerId = null;
    window.searchCustomer();
}

window.updateCustomerBalanceDisplay = function(customer) {
    document.getElementById('detail-customer-balance').innerText = `${formatIQD(customer.balance)} د.ع`;
}

window.savePayment = async function() {
    const amount = parseFloat(document.getElementById('payment-amount').value);
    if(isNaN(amount) || amount <= 0) return;

    const customer = data.customers.find(c => c.id === currentCustomerId);
    customer.balance -= amount;
    customer.lastUpdated = Date.now();
    
    addToQueue('edit', 'customers', customer);

    const now = new Date();
    const newTrans = {
        id: Date.now(),
        customerId: currentCustomerId,
        type: 'payment',
        amount: amount,
        date: now.toLocaleDateString('ar-IQ'),
        time: now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }),
        lastUpdated: Date.now()
    };

    data.transactions.push(newTrans);
    addToQueue('add', 'transactions', newTrans);

    await saveDataLocally();
    window.closeModal('paymentModal');
    document.getElementById('payment-amount').value = '';
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
}

window.changeRentInventory = function(num) {
    currentRentInventory = num;
    document.getElementById('btn-rent-inv-1').classList.remove('active');
    document.getElementById('btn-rent-inv-2').classList.remove('active');
    document.getElementById(`btn-rent-inv-${num}`).classList.add('active');
    
    const searches = document.querySelectorAll('.rent-item-search');
    searches.forEach(search => {
        search.value = '';
    });
    const prices = document.querySelectorAll('.rent-item-price');
    prices.forEach(price => {
        price.value = '0';
    });
}

window.openRentModal = function() {
    window.changeRentInventory(1);
    document.getElementById('rent-items-container').innerHTML = '';
    document.getElementById('rent-paid').value = '';
    document.getElementById('rent-days').value = '1';
    window.addRentItemRow(); 
    window.openModal('rentModal');
}

window.filterRentItems = function(input, rowId) {
    const query = input.value.toLowerCase().trim();
    const dropdown = document.getElementById(`dropdown-${rowId}`);
    let items = currentRentInventory === 1 ? data.inventory1 : data.inventory2;
    
    dropdown.innerHTML = '';
    
    let filtered = items;
    if (query) {
        filtered = items.filter(item => item.name.toLowerCase().startsWith(query));
    }

    if (filtered.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    filtered.forEach(item => {
        const div = document.createElement('div');
        div.style.padding = '10px';
        div.style.borderBottom = '1px solid #eee';
        div.style.cursor = 'pointer';
        div.innerText = `${item.name} (${formatIQD(item.price)} د.ع)`;
        div.onclick = function() {
            input.value = item.name;
            document.getElementById(`price-${rowId}`).value = item.price;
            dropdown.style.display = 'none';
        };
        dropdown.appendChild(div);
    });
    
    dropdown.style.display = 'block';
}

document.addEventListener('click', function(e) {
    if (!e.target.classList.contains('rent-item-search')) {
        document.querySelectorAll('.rent-item-dropdown').forEach(d => d.style.display = 'none');
    }
});

window.addRentItemRow = function() {
    const container = document.getElementById('rent-items-container');
    const rowId = Date.now();
    
    const rowHTML = `
        <div class="rent-item-row" id="row-${rowId}">
            <div style="position: relative; flex: 1;">
                <input type="text" id="search-${rowId}" class="rent-item-search" placeholder="ابحث عن مادة..." onkeyup="window.filterRentItems(this, ${rowId})" onfocus="window.filterRentItems(this, ${rowId})" autocomplete="off" style="margin-bottom:0;">
                <input type="hidden" id="price-${rowId}" class="rent-item-price" value="0">
                <div id="dropdown-${rowId}" class="rent-item-dropdown" style="display:none; position:absolute; background:white; width:100%; border:1px solid #bdc3c7; border-radius:4px; max-height:150px; overflow-y:auto; z-index:100; top:100%;"></div>
            </div>
            <input type="number" placeholder="الكمية" value="1" min="1" class="rent-item-qty" style="width: 70px; margin-bottom:0;">
            <button class="btn-danger btn-small" onclick="document.getElementById('row-${rowId}').remove();">X</button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHTML);
}

window.saveRentalTransaction = async function() {
    const paid = parseFloat(document.getElementById('rent-paid').value) || 0;
    const days = parseInt(document.getElementById('rent-days').value) || 1;
    const customer = data.customers.find(c => c.id === currentCustomerId);

    let itemsText = [];
    let itemsArray = [];
    let canRent = true;

    const searches = document.querySelectorAll('.rent-item-search');
    const qtys = document.querySelectorAll('.rent-item-qty');
    const prices = document.querySelectorAll('.rent-item-price');
    
    const nowTimestamp = Date.now();
    const returnDateTimestamp = nowTimestamp + (days * 86400000);

    searches.forEach((search, index) => {
        if(search.value.trim() !== '') {
            const itemName = search.value.trim();
            const qty = parseInt(qtys[index].value) || 1;
            const price = parseFloat(prices[index].value) || 0;
            
            let foundItem = data.inventory1.find(i => i.name === itemName);
            let invType = 1;
            if(!foundItem) {
                foundItem = data.inventory2.find(i => i.name === itemName);
                invType = 2;
            }

            if(foundItem) {
                if(foundItem.qty < qty) {
                    canRent = false;
                } else {
                    itemsArray.push({
                        id: foundItem.id,
                        name: foundItem.name,
                        qty: qty,
                        price: price,
                        invType: invType,
                        returnedQty: 0,
                        rentTimestamp: nowTimestamp
                    });
                    itemsText.push(`${itemName} (عدد ${qty})`);
                }
            } else {
                 canRent = false;
            }
        }
    });

    if(!canRent) {
        alert("المخزون لا يكفي أو المادة غير موجودة!");
        return;
    }

    itemsArray.forEach(item => {
        let collection = item.invType === 1 ? 'inventory1' : 'inventory2';
        let invItem = data[collection].find(i => i.id === item.id);
        if(invItem) { 
            invItem.qty -= item.qty; 
            invItem.lastUpdated = nowTimestamp; 
            addToQueue('edit', collection, invItem);
        }
    });

    customer.balance -= paid;
    customer.lastUpdated = nowTimestamp;
    addToQueue('edit', 'customers', customer);

    const now = new Date();
    const rawDate = now.toISOString().split('T')[0];
    const rawTime = now.toTimeString().slice(0, 5);

    const transaction = {
        id: nowTimestamp,
        customerId: currentCustomerId,
        type: 'rent',
        items: itemsText.join(' + '),
        itemsArray: itemsArray,
        days: days,
        returnDateTimestamp: returnDateTimestamp,
        totalCost: 0,
        paid: paid,
        date: now.toLocaleDateString('ar-IQ'),
        time: now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }),
        rawDate: rawDate,
        rawTime: rawTime,
        status: 'ongoing',
        returnHistory: [],
        lastUpdated: nowTimestamp
    };

    data.transactions.push(transaction);
    addToQueue('add', 'transactions', transaction);

    await saveDataLocally();
    window.closeModal('rentModal');
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
    window.renderInventory();
}

window.deleteTransaction = async function(id) {
    if(confirm("هل أنت متأكد من حذف هذه المعاملة؟ سيتم التراجع عن تأثيرها في حساب الزبون.")) {
        const trans = data.transactions.find(t => t.id === id);
        const customer = data.customers.find(c => c.id === trans.customerId);
        
        if (trans.type === 'rent') {
            let netImpact = (trans.totalCost || 0) - (trans.paid || 0);
            if(trans.remaining !== undefined) netImpact = trans.remaining;
            customer.balance -= netImpact;

            if(trans.itemsArray) {
                trans.itemsArray.forEach(item => {
                    const unreturnedQty = item.qty - item.returnedQty;
                    if(unreturnedQty > 0) {
                        let collection = item.invType === 1 ? 'inventory1' : 'inventory2';
                        let invItem = data[collection].find(i => i.id === item.id);
                        if(invItem) {
                            invItem.qty += unreturnedQty;
                            invItem.lastUpdated = Date.now();
                            addToQueue('edit', collection, invItem);
                        }
                    }
                });
            }
        } else if (trans.type === 'payment') {
            customer.balance += trans.amount; 
        }
        
        customer.lastUpdated = Date.now();
        addToQueue('edit', 'customers', customer);

        data.transactions = data.transactions.filter(t => t.id !== id);
        addToQueue('delete', 'transactions', { id: id });

        await saveDataLocally();
        window.updateCustomerBalanceDisplay(customer);
        window.renderTransactions();
        window.renderInventory();
    }
}

window.openEditTransactionModal = function(id) {
    const trans = data.transactions.find(t => t.id === id);
    if(trans && trans.type === 'rent') {
        document.getElementById('edit-trans-id').value = id;
        document.getElementById('edit-trans-items').value = trans.items || (trans.itemsArray ? trans.itemsArray.map(i=>`${i.name}(${i.qty})`).join(', ') : '');
        document.getElementById('edit-trans-date').value = trans.rawDate || '';
        document.getElementById('edit-trans-time').value = trans.rawTime || '';
        document.getElementById('edit-trans-days').value = trans.days || 1;
        
        const dailyRate = trans.days > 0 ? ((trans.total || trans.totalCost) / trans.days) : 0;
        document.getElementById('edit-trans-days').dataset.dailyRate = dailyRate;
        
        document.getElementById('edit-trans-total').value = trans.total || trans.totalCost || 0;
        document.getElementById('edit-trans-paid').value = trans.paid || 0;
        window.openModal('editTransactionModal');
    }
}

window.updateEditTotal = function() {
    const daysInput = document.getElementById('edit-trans-days');
    const dailyRate = parseFloat(daysInput.dataset.dailyRate) || 0;
    const newDays = parseInt(daysInput.value) || 0;
    document.getElementById('edit-trans-total').value = dailyRate * newDays;
}

window.saveEditTransaction = async function() {
    const id = parseInt(document.getElementById('edit-trans-id').value);
    const trans = data.transactions.find(t => t.id === id);
    const customer = data.customers.find(c => c.id === trans.customerId);
    
    const newItems = document.getElementById('edit-trans-items').value;
    const newDate = document.getElementById('edit-trans-date').value;
    const newTime = document.getElementById('edit-trans-time').value;
    const newDays = parseInt(document.getElementById('edit-trans-days').value) || trans.days;
    const newTotal = parseFloat(document.getElementById('edit-trans-total').value) || 0;
    const newPaid = parseFloat(document.getElementById('edit-trans-paid').value) || 0;
    
    let oldNet = trans.remaining !== undefined ? trans.remaining : ((trans.totalCost||0) - (trans.paid||0));
    customer.balance -= oldNet;
    
    trans.items = newItems;
    if(newDate) { trans.rawDate = newDate; trans.date = newDate; }
    if(newTime) { trans.rawTime = newTime; trans.time = newTime; }
    trans.days = newDays;
    trans.returnDateTimestamp = trans.id + (newDays * 86400000); // تحديث التنبيهات بناءً على الأيام الجديدة
    trans.total = newTotal;
    trans.totalCost = newTotal;
    trans.paid = newPaid;
    trans.remaining = trans.totalCost - trans.paid;
    
    customer.balance += trans.remaining;
    
    trans.lastUpdated = Date.now();
    customer.lastUpdated = Date.now();

    addToQueue('edit', 'transactions', trans);
    addToQueue('edit', 'customers', customer);

    await saveDataLocally();
    window.closeModal('editTransactionModal');
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
}

window.updateReturnCost = function(index, price, days) {
    const qty = parseInt(document.getElementById(`ret-qty-${index}`).value) || 0;
    const cost = days * price * qty;
    document.getElementById(`est-cost-${index}`).innerText = formatIQD(cost);
}

window.openReturnModal = function(id) {
    document.getElementById('return-trans-id').value = id;
    const trans = data.transactions.find(t => t.id === id);
    const container = document.getElementById('return-items-container');
    container.innerHTML = '';
    const now = Date.now();

    if(trans.itemsArray && trans.itemsArray.length > 0) {
        trans.itemsArray.forEach((item, index) => {
            const pendingQty = item.qty - item.returnedQty;
            if(pendingQty > 0) {
                const days = Math.max(1, Math.ceil((now - item.rentTimestamp) / 86400000));
                const estimatedCost = days * item.price * pendingQty;
                
                let html = `
                    <div class="rent-item-row" style="flex-direction:column; align-items:start; gap:5px;">
                        <div style="font-weight:bold;">${item.name} (الكمية الكلية: ${item.qty} | المتبقي للإرجاع: ${pendingQty})</div>
                        <div style="font-size:12px; color:gray;">الأيام المحسوبة: ${days} يوم | الإيجار الكلي للكمية المحددة بالأسفل: <span id="est-cost-${index}">${formatIQD(estimatedCost)}</span> د.ع</div>
                        <div style="display:flex; gap:5px; width:100%; flex-wrap:wrap;">
                            <input type="number" id="ret-qty-${index}" placeholder="الكمية المرجعة" value="${pendingQty}" min="1" max="${pendingQty}" oninput="window.updateReturnCost(${index}, ${item.price}, ${days})" style="margin-bottom:0; flex:1; min-width:100px;">
                            <button class="btn-success btn-small" onclick="window.processSingleReturn(${id}, ${index}, true)" style="margin-bottom:0; flex:1; min-width:120px;">إرجاع ودفع نقداً</button>
                            <button class="btn-warning btn-small" onclick="window.processSingleReturn(${id}, ${index}, false)" style="margin-bottom:0; flex:1; min-width:120px;">إرجاع وآجل (تسجيل بالدين)</button>
                        </div>
                    </div>
                `;
                container.innerHTML += html;
            }
        });
    } else {
        container.innerHTML = '<p>لا توجد تفاصيل مواد لهذه المعاملة القديمة.</p>';
    }

    const historyContainer = document.getElementById('return-history-container');
    historyContainer.innerHTML = '';
    
    if(trans.returnHistory && trans.returnHistory.length > 0) {
        trans.returnHistory.forEach(h => {
            historyContainer.innerHTML += `
                <div style="background: #f8f9fa; padding: 8px; margin-bottom: 5px; border-radius: 5px; border: 1px solid #e1e8ed; font-size: 13px;">
                    <strong>${h.itemName}</strong> | تم إرجاع: ${h.qty} | التكلفة: ${formatIQD(h.cost)} | تسديد: ${h.type} | التاريخ: ${h.date}
                </div>
            `;
        });
    } else {
        historyContainer.innerHTML = '<p style="font-size: 13px; color: #7f8c8d;">لا توجد إرجاعات سابقة.</p>';
    }

    window.openModal('returnModal');
}

window.processSingleReturn = async function(transId, itemIndex, isCash) {
    const trans = data.transactions.find(t => t.id === transId);
    const customer = data.customers.find(c => c.id === trans.customerId);
    const item = trans.itemsArray[itemIndex];
    
    const qtyInput = parseInt(document.getElementById(`ret-qty-${itemIndex}`).value) || 0;
    
    if(qtyInput <= 0 || qtyInput > (item.qty - item.returnedQty)) {
        alert("الكمية غير صالحة"); return;
    }

    const days = Math.max(1, Math.ceil((Date.now() - item.rentTimestamp) / 86400000));
    const cost = days * item.price * qtyInput;
    const payInput = isCash ? cost : 0;

    item.returnedQty += qtyInput;
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-IQ') + ' ' + now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });

    let collection = item.invType === 1 ? 'inventory1' : 'inventory2';
    let invItem = data[collection].find(i => i.id === item.id);
    if(invItem) {
        invItem.qty += qtyInput;
        invItem.lastUpdated = Date.now();
        addToQueue('edit', collection, invItem);
    }

    trans.totalCost = (trans.totalCost || 0) + cost;
    trans.paid += payInput;
    
    customer.balance += (cost - payInput);

    if(!trans.returnHistory) trans.returnHistory = [];
    trans.returnHistory.push({
        itemName: item.name,
        qty: qtyInput,
        cost: cost,
        paid: payInput,
        date: dateStr,
        type: isCash ? 'دفع نقدي' : 'آجل (دين)'
    });

    const allReturned = trans.itemsArray.every(i => i.returnedQty >= i.qty);
    if(allReturned) {
        trans.status = 'completed';
    } else {
        trans.status = 'ongoing';
    }

    trans.lastUpdated = Date.now();
    customer.lastUpdated = Date.now();

    addToQueue('edit', 'transactions', trans);
    addToQueue('edit', 'customers', customer);

    await saveDataLocally();
    window.openReturnModal(transId); 
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
    window.renderInventory();
}

window.renderTransactions = function() {
    const list = document.getElementById('transactions-list');
    list.innerHTML = '';
    
    const custTrans = data.transactions.filter(t => t.customerId === currentCustomerId).reverse();

    custTrans.forEach(t => {
        const displayTime = t.time ? t.time : ''; 
        
        if(t.type === 'payment') {
            list.innerHTML += `
                <div class="card" style="border-right: 5px solid #27ae60;">
                    <div class="card-info">
                        <h4 style="color:#27ae60;">تسديد نقد</h4>
                        <p>المبلغ: ${formatIQD(t.amount)} د.ع | التاريخ: ${t.date} ${displayTime}</p>
                    </div>
                    <div class="card-actions">
                        <button class="btn-success btn-small" onclick="window.sharePaymentWhatsApp(${t.id})" style="margin-bottom:3px;">واتساب</button>
                        <button class="btn-danger btn-small" onclick="window.deleteTransaction(${t.id})">حذف</button>
                    </div>
                </div>
            `;
        } else {
            const itemsDisplay = t.itemsArray ? t.itemsArray.map(i => `${i.name}(${i.qty})`).join(' + ') : t.items;
            
            let liveRunningCost = 0;
            if(t.itemsArray && t.status !== 'completed') {
                t.itemsArray.forEach(item => {
                    const pendingQty = item.qty - item.returnedQty;
                    if(pendingQty > 0) {
                        const days = Math.max(1, Math.ceil((Date.now() - item.rentTimestamp) / 86400000));
                        liveRunningCost += days * item.price * pendingQty;
                    }
                });
            }
            
            const totalDisplay = (t.totalCost || 0) + liveRunningCost;
            const remDisplay = totalDisplay - t.paid;

            list.innerHTML += `
                <div class="card" style="border-right: 5px solid #2980b9;">
                    <div class="card-info">
                        <h4>تأجير: ${itemsDisplay}</h4>
                        <p>التكلفة المحسوبة حتى الآن: ${formatIQD(totalDisplay)}</p>
                        <p>المدفوع: ${formatIQD(t.paid)} | الباقي: ${formatIQD(remDisplay)}</p>
                        <p>تاريخ: ${t.date} | الوقت: ${displayTime}</p>
                    </div>
                    <div class="card-actions">
                        <button class="btn-success btn-small" onclick="window.shareRentWhatsApp(${t.id})" style="margin-bottom:3px;">واتساب</button>
                        <button class="btn-primary btn-small" onclick="window.openReturnModal(${t.id})" style="margin-bottom:3px; background:linear-gradient(to bottom, #e67e22, #d35400);">الراجع</button>
                        ${t.status === 'completed' ? `<span style="color: #27ae60; font-size:14px; font-weight:bold; text-align:center; margin-bottom:5px;">مكتملة ✔</span>` : ''}
                        <button class="btn-warning btn-small" onclick="window.openEditTransactionModal(${t.id})" style="margin-bottom:3px;">تعديل</button>
                        <button class="btn-danger btn-small" onclick="window.deleteTransaction(${t.id})">حذف</button>
                    </div>
                </div>
            `;
        }
    });
}

window.sharePaymentWhatsApp = function(transId) {
    const trans = data.transactions.find(t => t.id === transId);
    const customer = data.customers.find(c => c.id === trans.customerId);
    const msg = `مرحباً ${customer.name}،\nتم استلام دفعة نقدية (تسديد لحسابكم) بمبلغ: ${formatIQD(trans.amount)} د.ع.\nتاريخ الدفعة: ${trans.date} - ${trans.time}\n\nإجمالي الديون المتبقية بذمتكم حالياً هو: ${formatIQD(customer.balance)} د.ع.\n\nشكراً لتعاملكم مع محلات كريم لتأجير العدد اليدوية!`;
    const encodedMessage = encodeURIComponent(msg);
    const whatsappUrl = `https://wa.me/${customer.phone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
}

window.shareRentWhatsApp = function(transId) {
    const trans = data.transactions.find(t => t.id === transId);
    const customer = data.customers.find(c => c.id === trans.customerId);
    
    let itemsDisplay = trans.itemsArray ? trans.itemsArray.map(i => `${i.name} (عدد ${i.qty})`).join(', ') : trans.items.replace(/<[^>]*>?/gm, ' ');
    
    let liveRunningCost = 0;
    if(trans.itemsArray && trans.status !== 'completed') {
        trans.itemsArray.forEach(item => {
            const pendingQty = item.qty - item.returnedQty;
            if(pendingQty > 0) {
                const days = Math.max(1, Math.ceil((Date.now() - item.rentTimestamp) / 86400000));
                liveRunningCost += days * item.price * pendingQty;
            }
        });
    }
    
    const totalDisplay = (trans.totalCost || 0) + liveRunningCost;
    const remDisplay = totalDisplay - trans.paid;

    const message = `*محلات كريم لتأجير العدد اليدوية*\n\nمرحباً ${customer.name}،\nتفاصيل التأجير:\nالمواد: ${itemsDisplay}\nالمبلغ المحسوب حتى الآن: ${formatIQD(totalDisplay)} د.ع\nالمدفوع: ${formatIQD(trans.paid)} د.ع\nالمتبقي من هذه الفاتورة: ${formatIQD(remDisplay)} د.ع\n\nإجمالي الباقي بذمتكم: ${formatIQD(customer.balance)} د.ع\n\nشكراً لتعاملكم معنا!`;
    
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${customer.phone}?text=${encodedMessage}`;
    
    window.open(whatsappUrl, '_blank');
}

window.renderAlerts = function() {
    const list = document.getElementById('alerts-list');
    list.innerHTML = '';
    
    const now = Date.now();
    let hasAlerts = false;

    data.transactions.forEach(t => {
        if(t.type === 'rent' && t.status === 'ongoing' && t.returnDateTimestamp && t.returnDateTimestamp < now) {
            hasAlerts = true;
            const customer = data.customers.find(c => c.id === t.customerId);
            
            const diffTime = Math.abs(now - t.returnDateTimestamp);
            const delayDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            list.innerHTML += `
                <div class="card" style="border-right: 5px solid #e74c3c; background-color: #fdf0ed;">
                    <div class="card-info">
                        <h4 style="color:#c0392b;">تأخير: ${customer.name}</h4>
                        <p>المواد: ${t.items.replace(/<[^>]*>?/gm, ' ')}</p>
                        <p>مدة التأخير: ${delayDays} يوم</p>
                        <p>الرقم: +${customer.phone}</p>
                    </div>
                    <div class="card-actions">
                        <a href="https://wa.me/${customer.phone}" target="_blank" class="btn-success btn-small" style="text-decoration:none; text-align:center;">مراسلة</a>
                    </div>
                </div>
            `;
        }
    });

    if(!hasAlerts) {
        list.innerHTML = '<p style="text-align:center; color:#7f8c8d; margin-top:20px; font-weight:bold;">لا توجد تنبيهات حالياً.</p>';
    }
}

function renderUI() {
    if(document.getElementById('tab-inventory').classList.contains('active')) window.renderInventory();
    if(document.getElementById('tab-customers').classList.contains('active')) window.renderCustomers();
    if(document.getElementById('customer-details-view').style.display === 'block') window.renderTransactions();
}

// دالة التبديل بين الوضع الليلي والنهاري
window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
}

// التحقق من الوضع المحفوظ عند التحميل
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
}

initData();
