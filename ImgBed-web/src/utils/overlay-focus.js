function getDefaultActiveElement() {
  return globalThis.document?.activeElement ?? null;
}

function scheduleWithTimeout(callback) {
  const scope = globalThis.window ?? globalThis;
  if (typeof scope.setTimeout === 'function') {
    return scope.setTimeout(callback, 0);
  }
  callback();
  return null;
}

function scheduleWithAnimationFrame(callback) {
  const scope = globalThis.window ?? globalThis;
  if (typeof scope.requestAnimationFrame === 'function') {
    return scope.requestAnimationFrame(() => callback());
  }
  return scheduleWithTimeout(callback);
}

export function resolveFocusTrigger(trigger, fallback = getDefaultActiveElement()) {
  if (trigger && typeof trigger === 'object') {
    if ('current' in trigger) {
      return resolveFocusTrigger(trigger.current, fallback);
    }
    if (typeof trigger.focus === 'function' || typeof trigger.blur === 'function') {
      return trigger;
    }
  }

  if (fallback && (typeof fallback.focus === 'function' || typeof fallback.blur === 'function')) {
    return fallback;
  }

  return null;
}

export function blurFocusTrigger(trigger) {
  if (trigger && typeof trigger.blur === 'function') {
    trigger.blur();
  }
  return trigger;
}

export function canRestoreFocus(trigger) {
  if (!trigger || typeof trigger.focus !== 'function') {
    return false;
  }

  if (trigger.isConnected === false) {
    return false;
  }

  if ('disabled' in trigger && trigger.disabled) {
    return false;
  }

  if (typeof trigger.getAttribute === 'function' && trigger.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  return true;
}

export function restoreFocusTrigger(trigger) {
  if (!canRestoreFocus(trigger)) {
    return false;
  }

  trigger.focus({ preventScroll: true });
  return true;
}

export function createOverlayFocusManager({
  getActiveElement = getDefaultActiveElement,
  scheduleOpen = scheduleWithTimeout,
  scheduleFocus = scheduleWithAnimationFrame,
} = {}) {
  let restoreTarget = null;
  let pendingMenuAction = null;

  const captureRestoreTarget = (trigger) => {
    restoreTarget = resolveFocusTrigger(trigger, getActiveElement());
    return restoreTarget;
  };

  const blurCurrentFocus = () => {
    const activeElement = getActiveElement();
    blurFocusTrigger(activeElement);
    if (restoreTarget && restoreTarget !== activeElement) {
      blurFocusTrigger(restoreTarget);
    }
  };

  return {
    open(trigger, openOverlay) {
      captureRestoreTarget(trigger);
      blurCurrentFocus();
      if (typeof openOverlay === 'function') {
        openOverlay();
      }
      return restoreTarget;
    },

    queueMenuAction({
      restoreTarget: nextRestoreTarget,
      closeMenu,
      openOverlay,
    } = {}) {
      captureRestoreTarget(nextRestoreTarget);
      blurCurrentFocus();
      pendingMenuAction = typeof openOverlay === 'function' ? openOverlay : null;
      if (typeof closeMenu === 'function') {
        closeMenu();
      }
    },

    flushPendingMenuAction() {
      const action = pendingMenuAction;
      pendingMenuAction = null;
      if (typeof action === 'function') {
        scheduleOpen(action);
      }
    },

    close(closeOverlay, { restoreFocus = true } = {}) {
      if (typeof closeOverlay === 'function') {
        closeOverlay();
      }

      if (restoreFocus) {
        scheduleFocus(() => restoreFocusTrigger(restoreTarget));
      }
      return restoreTarget;
    },

    restoreFocus() {
      return restoreFocusTrigger(restoreTarget);
    },

    clear() {
      restoreTarget = null;
      pendingMenuAction = null;
    },

    hasPendingMenuAction() {
      return typeof pendingMenuAction === 'function';
    },
  };
}
