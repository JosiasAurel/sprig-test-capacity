
const CONTROLLER_URL = "http://127.0.0.1:3001";
const ROOM_COUNT = 100;
const CLIENT_COUNT = 100;

async function sendCommand(path) {
    console.log("Path", path);
    const response = await fetch(`${CONTROLLER_URL}/${path}`);
    // const data = await response.text();
    const data = await response.json();

    return data;
}