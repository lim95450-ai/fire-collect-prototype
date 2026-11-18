/* 암호화 저장소: 일반 자료 저장소(Files)와 개인정보 Vault를 별도 DB·별도 키로 분리.
 * ※ 프로토타입에서는 키를 localStorage에 둡니다. 운영 단계에서는 별도 서버/KMS·HSM에서 관리해야 합니다. */
(function (g) {
  const b64 = {
    enc: (u8) => btoa(String.fromCharCode(...u8)),
    dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  };

  class SecureIDB {
    constructor(dbName, keyName, label) {
      this.dbName = dbName; this.keyName = keyName; this.label = label;
      this.db = null; this.key = null;
    }
    async init() {
      this.db = await new Promise((res, rej) => {
        const rq = indexedDB.open(this.dbName, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('items', { keyPath: 'id' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      let raw = localStorage.getItem(this.keyName);
      if (!raw) {
        const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        raw = b64.enc(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
        localStorage.setItem(this.keyName, raw);
      }
      this.key = await crypto.subtle.importKey('raw', b64.dec(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    _tx(mode) { return this.db.transaction('items', mode).objectStore('items'); }
    _req(rq) { return new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
    async put(id, bytes, meta) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, bytes));
      await this._req(this._tx('readwrite').put({ id, iv, data, meta: meta || {}, at: Date.now() }));
      return id;
    }
    async get(id) {
      const rec = await this._req(this._tx('readonly').get(id));
      if (!rec) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, this.key, rec.data);
      return { bytes: new Uint8Array(plain), meta: rec.meta };
    }
    async raw(id) { return this._req(this._tx('readonly').get(id)); }
    async del(id) { await this._req(this._tx('readwrite').delete(id)); }
    async count() { return this._req(this._tx('readonly').count()); }
    async all() { return this._req(this._tx('readonly').getAll()); }
    async clear() { await this._req(this._tx('readwrite').clear()); }
  }

  const enc = new TextEncoder(), dec = new TextDecoder();

  const Vault = new SecureIDB('fire_vault', 'fire_vault_key', '개인정보 Vault');
  Vault.putText = (text, meta) => Vault.put('TKN-' + U.uid(), enc.encode(String(text)), { ...meta, kind: 'text' });
  Vault.getText = async (token) => { const r = await Vault.get(token); return r ? dec.decode(r.bytes) : null; };
  Vault.putFile = (bytes, meta) => Vault.put('TKN-' + U.uid(), new Uint8Array(bytes), { ...meta, kind: 'file' });
  Vault.isToken = (v) => typeof v === 'string' && /^TKN-[a-z0-9]+$/.test(v);

  const Files = new SecureIDB('fire_main', 'fire_main_key', '일반 자료 저장소');
  Files.putFile = (bytes, meta) => Files.put('F-' + U.uid(), new Uint8Array(bytes), meta);

  g.Vault = Vault;
  g.Files = Files;
  g.SecureIDB = SecureIDB;
})(window);
