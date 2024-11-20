import express from "express";
import * as Y from "yjs";
import admin from "firebase-admin";
import { WebrtcProvider } from "./y-webrtc.js";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { config } from "dotenv";
import { StatsD } from "node-statsd";
import { configDotenv } from "dotenv";
import crypto from "node:crypto";
import { spawn, fork } from "node:child_process";
config();

const app = express();
app.use(express.json());

let portNumber = 4000;

const updates = {};

function buildRoomWithClients(roomName = "oDWL6LS54Dt1rpFdftyW", NUM_CLIENTS) {

  const clients = new Array(NUM_CLIENTS).fill(0).map(function (_, idx) {
    const controller = new AbortController();
    const { signal } = controller;
    const child_client = fork("./client.js", [idx, roomName, portNumber], { signal })

    portNumber += 1;
    updates[roomName] = {
      ...updates[roomName],
      [child_client.pid]: { lastTime: 0, delay: 0, count: 0 }
    }
    // updates[roomName][child_client.pid] = { lastTime: 0, delay: 0, count: 0 };

    console.log("spawned child", child_client.pid, roomName);
    child_client.on("message", message => {
      
      console.log(child_client.pid, "Sending update to index", idx);
      updates[roomName][child_client.pid] = {
        lastTime: message.now,
        delay: message.now - updates[roomName][child_client.pid].lastTime,
        count: updates[roomName][child_client.pid].count + 1,
        pid: child_client.pid,
        roomName: message.roomName,
        childId: message.id,
        dead: false
      }
    });

    child_client.on("error", (error) => {

      updates[roomName][child_client.pid] = { ...updates[roomName][child_client.pid], dead: true };
      controller.abort(); // terminate the process on error
    });

    return { controller, child_client };
  });

  // randomly choose client that will send message
  let randomClient = clients[Math.floor(Math.random() * clients.length)];
  randomClient.child_client.send({ action: "message" });

  return { id: roomName, clients };
}

function main() {
  const NUM_CLIENTS = 2;
  const NUM_ROOMS = 2;

  new Array(NUM_ROOMS).fill(0).map(() => {
    let roomId = crypto.randomUUID()
    return roomId;
  })
    .map((room, idx) => {
      // build room with clients
      return buildRoomWithClients(room, NUM_CLIENTS);
    });

  // setInterval(() => {
  //   console.clear();
  //   Object.keys(updates).forEach((roomKey, roomIdx) => {
  //     const childClients = updates[roomKey];
  //     console.group(`Room ${roomIdx} / ID: ${roomKey}`);
  //     console.table(Object.values(childClients))
  //     // console.table(childClients);
  //     console.groupEnd();
  //   });

  // }, 1000);

}

main();

app.get("/", (req, res) => {
  res.send("Working...");
})

app.get("/create-room/:roomName/:clients", (req, res) => {
  const roomName = req.params.roomName;
  const clientCount = parseInt(req.params.clients ?? '0');

  // should add a ref to the room in a 'rooms' object so they can be updated later
  buildRoomWithClients(roomName, clientCount);

  res.status(200).end();
})

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Listening on port", PORT));