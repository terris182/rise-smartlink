export const NextResponse = { json: (body, init = {}) => ({ status: init.status || 200, body }) };
