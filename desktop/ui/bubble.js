const card = document.getElementById('bubble'), text = document.getElementById('text');
function measure() { window.bubble.resized(Math.ceil(card.getBoundingClientRect().height + 20)); }
window.bubble.onUpdate(value => {
  text.textContent = value.text;
  document.body.dataset.side = value.side;
  card.style.fontSize = value.fontSize + 'px';
  text.style.maxHeight = Math.max(60, value.maxHeight - 48) + 'px';
  card.classList.toggle('visible', Boolean(value.text));
  requestAnimationFrame(measure);
});
new ResizeObserver(measure).observe(card);
