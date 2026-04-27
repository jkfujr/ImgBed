const LOGIN_TABS = {
  GUEST: 'guest',
  ADMIN: 'admin',
};

function canShowGuestPasswordTab(config) {
  return Boolean(config?.guestUploadEnabled && config?.requirePassword);
}

function resolveLoginTab(requestedTab, guestPasswordTabVisible) {
  if (!guestPasswordTabVisible) {
    return LOGIN_TABS.ADMIN;
  }

  return requestedTab === LOGIN_TABS.ADMIN ? LOGIN_TABS.ADMIN : LOGIN_TABS.GUEST;
}

function resolveLoginViewState({ requestedTab, guestUploadConfig }) {
  const guestPasswordTabVisible = canShowGuestPasswordTab(guestUploadConfig);

  return {
    guestPasswordTabVisible,
    tabValue: resolveLoginTab(requestedTab, guestPasswordTabVisible),
  };
}

export {
  LOGIN_TABS,
  canShowGuestPasswordTab,
  resolveLoginTab,
  resolveLoginViewState,
};
