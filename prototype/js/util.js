/* 공통 유틸리티 */
(function (g) {
  const pad = (n) => String(n).padStart(2, '0');

  const U = {
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    uid(p) {
      return (p || '') + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
    },
    fmt(ts) {
      const d = new Date(ts);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    fmtD(ts) {
      const d = new Date(ts);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    /** 공문서 표기: 2026. 11. 7. */
    fmtKoDoc(ts) {
      const d = new Date(ts);
      return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
    },
    toInputDate(ts) {
      return U.fmtD(ts);
    },
    /** yyyy-mm-dd → 해당일 23:59:59 */
    fromInputDate(str) {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d, 23, 59, 59).getTime();
    },
    dday(ts) {
      const a = new Date(ts); a.setHours(0, 0, 0, 0);
      const b = new Date(); b.setHours(0, 0, 0, 0);
      return Math.round((a - b) / 86400000);
    },
    ddayLabel(ts) {
      const d = U.dday(ts);
      return d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : `D+${-d}`;
    },
    size(n) {
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1048576).toFixed(1) + ' MB';
    },
    readFile(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsArrayBuffer(file);
      });
    },
    download(data, name, mime) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
    toast(msg, kind) {
      let box = document.getElementById('toasts');
      if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || '');
      t.textContent = msg;
      box.appendChild(t);
      setTimeout(() => t.classList.add('hide'), 3200);
      setTimeout(() => t.remove(), 3700);
    },
    /**
     * 모달. buttons: [{label, cls, onClick(el)}]  onClick이 false 반환 시 닫지 않음.
     */
    modal(title, bodyHtml, opts) {
      opts = opts || {};
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-h"><h3>${U.esc(title)}</h3><button class="x" aria-label="닫기">×</button></div>
        <div class="modal-b">${bodyHtml}</div>
        <div class="modal-f"></div></div>`;
      document.body.appendChild(back);
      const el = back.querySelector('.modal');
      const close = () => back.remove();
      back.querySelector('.x').onclick = close;
      back.addEventListener('mousedown', (e) => { if (e.target === back && opts.dismiss !== false) close(); });
      const foot = back.querySelector('.modal-f');
      (opts.buttons || [{ label: '닫기', cls: '' }]).forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'btn ' + (b.cls || '');
        btn.textContent = b.label;
        btn.onclick = async () => {
          const r = b.onClick ? await b.onClick(el, close) : undefined;
          if (r !== false) close();
        };
        foot.appendChild(btn);
      });
      if (opts.onMount) opts.onMount(el, close);
      return { el, close };
    },
    confirm(msg, okLabel) {
      return new Promise((resolve) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; resolve(v); } };
        const m = U.modal('확인', `<p style="white-space:pre-wrap;margin:0">${U.esc(msg)}</p>`, {
          dismiss: false,
          buttons: [
            { label: '취소', onClick: () => fin(false) },
            { label: okLabel || '확인', cls: 'primary', onClick: () => fin(true) },
          ],
        });
        m.el.querySelector('.x').addEventListener('click', () => fin(false));
      });
    },
    /** 사유 입력 */
    prompt(title, label, opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; resolve(v); } };
        const m = U.modal(title, `<label class="fld"><span>${U.esc(label)}</span><textarea id="pr-t" rows="3" placeholder="${U.esc(opts.placeholder || '')}"></textarea></label>
          ${opts.note ? `<p class="hint">${opts.note}</p>` : ''}`, {
          dismiss: false,
          buttons: [
            { label: '취소', onClick: () => fin(null) },
            {
              label: opts.okLabel || '확인', cls: 'primary', onClick: (el) => {
                const v = el.querySelector('#pr-t').value.trim();
                if (opts.required !== false && !v) { U.toast('내용을 입력해 주세요.', 'warn'); return false; }
                fin(v);
              },
            },
          ],
        });
        m.el.querySelector('.x').addEventListener('click', () => fin(null));
        m.el.querySelector('#pr-t').focus();
      });
    },
    /** 조직명 축약: '신평119안전센터' → '신평' (파일명 접두 등에 사용) */
    orgShort(name) {
      const raw = String(name || '');
      return raw.replace(/119안전센터|안전센터|119구조대|구조대|소방서|119소방정대|소방정대/g, '').trim() || raw;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  g.U = U;
  if (typeof module !== 'undefined') module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
