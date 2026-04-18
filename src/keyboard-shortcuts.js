function isShortcutSuppressedElement(element) {
  if (!(element instanceof HTMLElement)) return false;
  return Boolean(element.closest('[data-shortcut-scope="city-search"]'));
}

export function shouldSuppressGlobalShortcuts(event) {
  if (event?.target && isShortcutSuppressedElement(event.target)) {
    return true;
  }

  return isShortcutSuppressedElement(document.activeElement);
}
