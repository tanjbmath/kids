
/* Fox mascot artwork: keeps existing gameplay handlers and DOM IDs intact. */
(function(){
  const foxAssets = {
    neutral: 'assets/fox/fox-neutral.png',
    curious: 'assets/fox/fox-curious.png',
    happy: 'assets/fox/fox-laugh.png',
    think: 'assets/fox/fox-think.png',
    sad: 'assets/fox/fox-sad.png',
    victory: 'assets/fox/fox-victory.png'
  };
  function refreshMascot(img){
    if (!img || !img.classList || !img.classList.contains('mascot')) return;
    let state = 'neutral';
    if (img.id === 'mascot-results') state = 'victory';
    else if (img.classList.contains('sad')) state = 'sad';
    else if (img.classList.contains('happy')) state = 'happy';
    else if (img.dataset.foxThinking === 'true') state = 'think';
    const next = state === 'neutral' ? (img.dataset.baseSrc || foxAssets.neutral) : foxAssets[state];
    if (next && img.getAttribute('src') !== next) img.setAttribute('src', next);
  }
  function refreshAll(){
    document.querySelectorAll('img.mascot').forEach(refreshMascot);
  }
  document.addEventListener('DOMContentLoaded', function(){
    refreshAll();
    document.querySelectorAll('img.mascot').forEach(function(img){
      new MutationObserver(function(){ refreshMascot(img); })
        .observe(img, {attributes:true, attributeFilter:['class','data-fox-thinking']});
    });
    /* Hint controls temporarily show the thinking fox; gameplay logic remains unchanged. */
    document.addEventListener('click', function(event){
      const control = event.target.closest('button,[role="button"]');
      if (!control) return;
      const label = ((control.textContent || '') + ' ' + (control.getAttribute('aria-label') || '') + ' ' + (control.id || '')).toLowerCase();
      if (/hint|help|clue|think/.test(label)) {
        const screen = control.closest('.screen');
        const mascot = screen && screen.querySelector('img.mascot');
        if (mascot) {
          mascot.dataset.foxThinking = 'true';
          refreshMascot(mascot);
          window.setTimeout(function(){
            if (mascot && mascot.isConnected) {
              delete mascot.dataset.foxThinking;
              refreshMascot(mascot);
            }
          }, 1800);
        }
      }
    });
  });
  /* If this script runs after DOMContentLoaded, still initialise. */
  if (document.readyState !== 'loading') refreshAll();
})();
