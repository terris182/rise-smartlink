export const store = { link: null, updates: null };
export const getLink = async () => store.link;
export const updateLink = async (slug, updates) => { store.updates = updates; store.link = { ...store.link, ...updates }; return store.link; };
export const getAllLinks = async () => [];
export const createLink = async () => { throw new Error('createLink is not available in route tests'); };
