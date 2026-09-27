import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
}

export interface FakeServer {
	url: string;
	requests: Recorded[];
	close(): void;
}

export async function fakeServer(reply: (request: Recorded, res: ServerResponse) => void): Promise<FakeServer> {
	const requests: Recorded[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const request = {
			method: req.method ?? "",
			path: req.url ?? "",
			headers: req.headers,
			body: Buffer.concat(chunks).toString("utf8"),
		};
		requests.push(request);
		reply(request, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		requests,
		close: () => {
			server.close();
			server.closeAllConnections();
		},
	};
}

export function sse(chunks: unknown[]): string {
	return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
	res.writeHead(status, { "content-type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

export function stream(res: ServerResponse, body: string): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.end(body);
}
