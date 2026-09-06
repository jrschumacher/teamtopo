export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
	});
}

export function error(code: string, message: string, status: number): Response {
	return json({ error: code, message }, status);
}

export function redirect(location: string, status = 303): Response {
	return new Response(null, { status, headers: { Location: location } });
}
