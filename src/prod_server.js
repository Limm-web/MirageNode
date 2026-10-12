const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: "Welcome to the real production server!" }));
}).listen(3000, () => console.log("[PROD] Real production server running on port 3000"));
