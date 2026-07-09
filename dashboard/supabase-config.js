

window.SUPABASE_URL      = 'https://gfmcsuqehgbetdsszwyd.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbWNzdXFlaGdiZXRkc3N6d3lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMzE5NjAsImV4cCI6MjA5NjYwNzk2MH0.frXLKeNjyWFF15gog9Qr5Mfvl8Yaqlhuvmgp-O8drPg';


(function validateConfig() {
  const PLACEHOLDER_URL = 'YOUR_SUPABASE_URL';
  const PLACEHOLDER_KEY = 'YOUR_SUPABASE_ANON_KEY';

  const urlMissing  = !window.SUPABASE_URL  || window.SUPABASE_URL  === PLACEHOLDER_URL;
  const keyMissing  = !window.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY === PLACEHOLDER_KEY;

  if (urlMissing || keyMissing) {
 
    document.addEventListener('DOMContentLoaded', () => {
      const banner = document.createElement('div');
      banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
        'background:#7f1d1d', 'color:#fca5a5', 'font-family:monospace',
        'font-size:13px', 'padding:14px 20px', 'border-bottom:2px solid #ef4444',
        'display:flex', 'align-items:center', 'gap:12px'
      ].join(';');
      banner.innerHTML = `
        <strong>⚠ NXTUP Lead — Supabase not configured</strong>
        <span style="font-weight:normal;opacity:0.85">
          Open <code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:3px">supabase-config.js</code>
          and replace the placeholder URL and key with your real Supabase credentials.
        </span>`;
      document.body.prepend(banner);
    });

    console.error(
      '%c[NXTUP Auth] supabase-config.js has placeholder values.\n' +
      'Open supabase-config.js and set your real Project URL and anon key.\n' +
      'Supabase Dashboard → Project Settings → API',
      'color:#ef4444; font-weight:bold; font-size:14px'
    );
  }
})();
