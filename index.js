import express from "express";
import * as Y from "yjs";
import admin from "firebase-admin";
import { WebrtcProvider } from "./y-webrtc.js";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { config } from "dotenv";
import { StatsD } from "node-statsd";
import { configDotenv } from "dotenv";
import crypto from "node:crypto";
import { fork } from "node:child_process";
config();

const app = express();
app.use(express.json());

const SIGNALING_SERVERS = ["wss://yjs-signaling-server-5fb6d64b3314.herokuapp.com/"]

let roomsListening = [];

function generateRoomIds(roomCount = 10) {
  return new Array(roomCount).fill(0).map(_ => crypto.randomUUID());
}

let rooms = generateRoomIds();

const buildLogger = id => thing => console.log(id, thing);

// @param updates {Array<number>} - used to indicate the number of updates each client has received since the start of the program
function createClient(id = 0, roomName, updates) {
  const log = buildLogger(id);

  let clientDoc = new Y.Doc();
  new WebrtcProvider(roomName, clientDoc, { signaling: SIGNALING_SERVERS });

  clientDoc.on("update", update => {
    const updateText = clientDoc.getText("codemirror");
    Y.applyUpdate(clientDoc, updateText);
    
    log("got update");
    updates[id] += 1;
    // console.log(updateText);
  });
  
  // send updates at random indices every 2.5 seconds
  setInterval(() => {
    clientDoc.getText("codemirror").insert(Math.floor(Math.random(), 10), "this change came from the headless client");
  }, 2500);
}

function buildRoomWithClients(roomName = "oDWL6LS54Dt1rpFdftyW", NUM_CLIENTS, updates) {

  const clients = new Array(NUM_CLIENTS).fill(0).map((_, idx) => {
    const controller = new AbortController();
    const { signal } = controller;
    const child_client = fork("./client.js", [ idx ], { signal })

    // update the number of messages received by child client when it gets new updates
    child_client.on("message", () => {
      updates[idx] += 1;
    });

    child_client.on("message", message => {
      // const { idx } = JSON.parse(message)
      updates[idx] += 1;
    });

    child_client.on("error", () => {
      updates[idx] = -1;
    });

    return { controller, child_client };
  });

  // terminate all clients when receiving the termination signal
  process.on("SIGINT", () => {
    // terminate all child processes
    clients.forEach(client => client.controller.abort())

    // terminate parent process
    process.exit(1);
  });

  // setInterval(() => {
  //   console.clear();
  //   console.log(updates);
  // }, 1000);

}

function main() {
  const NUM_CLIENTS = 10;
  const NUM_ROOMS = 5;
  const roomsWithClientsUpdates = new Array(NUM_ROOMS).fill(
    new Array(NUM_CLIENTS).fill(0)
  );

  const roomsWithClients = new Array(NUM_ROOMS).fill(0).map(() => crypto.randomUUID())
    .map((room, idx) => {
      // build room with clients
      buildRoomWithClients(room, NUM_CLIENTS, roomsWithClientsUpdates[idx]);
    });

    setInterval(() => {
      roomsWithClientsUpdates.forEach((roomwithClients, idx) => {
        console.log(`Room ${idx} has clients => `, roomwithClients);
      });
    }, 1000);
  // buildRoomWithClients("oDWL6LS54Dt1rpFdftyW");
}

main();


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Listening on port", PORT));
