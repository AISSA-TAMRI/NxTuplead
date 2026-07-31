// Dark mode toggle — standalone, does not touch app logic above.
(function(){
  var saved = localStorage.getItem('nxtup-theme');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
  function applyTheme(t){
    if(t==='dark'){ document.documentElement.setAttribute('data-theme','dark'); }
    else{ document.documentElement.removeAttribute('data-theme'); }
    var icon = document.getElementById('themeToggleIcon');
    if(icon) icon.textContent = t==='dark' ? 'light_mode' : 'dark_mode';
  }
  window.toggleAppTheme = function(){
    var isDark = document.documentElement.getAttribute('data-theme')==='dark';
    var next = isDark ? 'light' : 'dark';
    localStorage.setItem('nxtup-theme', next);
    applyTheme(next);
  };
})();
