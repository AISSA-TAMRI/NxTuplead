// Fetches every page fragment and injects it into its placeholder,
// then boots the application. Keeps behavior identical to the original
// single-file version, just with the markup split into /pages/*.html
(async function(){
  var placeholders = document.querySelectorAll('.pv[data-src]');
  await Promise.all(Array.prototype.map.call(placeholders, function(el){
    return fetch(el.getAttribute('data-src'))
      .then(function(r){ return r.text(); })
      .then(function(html){ el.innerHTML = html; })
      .catch(function(err){ console.error('Failed to load page fragment', el.getAttribute('data-src'), err); });
  }));
  if (window.__initApp) window.__initApp();
})();
