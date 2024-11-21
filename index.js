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
import { stringify } from "csv";
import { writeFileSync } from "node:fs";
config();

const CHILD_PROCESS_MAX_LISTENERS = 100;
const app = express();
app.use(express.json());

let portNumber = 4000;

let updates = {};

function spawnChild(parentRoom, idx) {
  const controller = new AbortController();
  const { signal } = controller;

  const childClient = fork("./client.js", [ idx, parentRoom ], { signal });
  const pid = childClient.pid;

  childClient.setMaxListeners(CHILD_PROCESS_MAX_LISTENERS);

  updates[parentRoom] = {
    ...updates[parentRoom],
    [pid]: { lastTime: 0, delay: 0, count: 0, child: childClient, controller: controller, pid: pid, dead: false }
  }

  console.log("spawned child", childClient.pid, parentRoom);

  childClient.on("message", message => {
      console.log(childClient.pid, "Sending update to index", idx);
      if (message.type !== 'update') return;

      updates[parentRoom][pid] = {
        ...updates[parentRoom][pid],
        lastTime: message.now,
        delay: updates[parentRoom][pid].lastTime === 0 ? 0 : message.now - updates[parentRoom][pid].lastTime,
        count: updates[parentRoom][pid].count + 1,
      }
  })

  childClient.on("error", _ => {
    updates[parentRoom][pid] = { ...updates[parentRoom][pid], dead: true };
    controller.abort();
  })

  return { controller, childClient };
}

function buildRoomWithClients(roomName = "oDWL6LS54Dt1rpFdftyW", NUM_CLIENTS) {

  const clients = new Array(NUM_CLIENTS).fill(0).map(function (_, idx) {
    // const controller = new AbortController();
    // const { signal } = controller;
    // const child_client = fork("./client.js", [idx, roomName, portNumber], { signal })

    // portNumber += 1;
    // updates[roomName] = {
    //   ...updates[roomName],
    //   [child_client.pid]: { lastTime: 0, delay: 0, count: 0 }
    // }
    // // updates[roomName][child_client.pid] = { lastTime: 0, delay: 0, count: 0 };

    // console.log("spawned child", child_client.pid, roomName);
    // child_client.on("message", message => {
      
    //   console.log(child_client.pid, "Sending update to index", idx);
    //   updates[roomName][child_client.pid] = {
    //     lastTime: message.now,
    //     delay: message.now - updates[roomName][child_client.pid].lastTime,
    //     count: updates[roomName][child_client.pid].count + 1,
    //     pid: child_client.pid,
    //     roomName: message.roomName,
    //     childId: message.id,
    //     dead: false
    //   }
    // });

    // child_client.on("error", (error) => {

    //   updates[roomName][child_client.pid] = { ...updates[roomName][child_client.pid], dead: true };
    //   controller.abort(); // terminate the process on error
    // });

    // return { controller, child_client };
    return spawnChild(roomName, idx);
  });

  // randomly choose client that will send message
  // let randomClient = clients[Math.floor(Math.random() * clients.length)];
  // randomClient.child_client.send({ action: "message" });

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

  setInterval(() => {
    console.clear();
    Object.keys(updates).forEach((roomKey, roomIdx) => {
      const childClients = updates[roomKey];
      let childClientValues = Object.values(childClients);
      childClientValues = childClientValues.map(childClientValue => Object.fromEntries(Object.entries(childClientValue).filter(entry => !entry.includes('controller'))))
      const averageDelay = childClientValues.reduce((totalDelay, currentClient) => totalDelay + currentClient.delay, 0) / childClientValues.length;
      console.group(`Room ${roomIdx} / ID: ${roomKey}`);
      console.log("Average Delay: ", averageDelay);
      console.table(childClientValues)
      // console.table(childClients);
      console.groupEnd();
    });

  }, 1000);

}

main();

app.get("/", (req, res) => {
  res.send("Working...");
})

function createRoom(roomName, clientCount) {
  // create the room if it doesn't exist yet
  if (!Object.hasOwn(updates, roomName)) {
    updates = { ...updates, [roomName]: {} };
  }

  // add clients to the room
  for (let i = 0; i < clientCount; i++) {
    spawnChild(roomName, Object.keys(updates[roomName]).length);
  }
}

function resetRoomAndClients() {
  Object.values(updates).forEach(roomClients => {
    Object.values(roomClients).forEach(client => client.controller.abort());
  })

  // flush the updates array
  updates = {};
}

// this can be used for both spinning up a room with clients or adding new clients to an existing room
app.get("/create-room/:roomName/:clients", (req, res) => {
  const roomName = req.params.roomName;
  const clientCount = parseInt(req.params.clients ?? '0');

  createRoom(roomName, clientCount);
  res.status(200).json({ ok: true });
})

app.get("/delete-room/:roomName", (req, res) => {
  const roomName = req.params.roomName;

  if (!Object.hasOwn(updates, roomName)) res.json({ ok: false, msg: "Room does not exist" });

  // kill all the clients in that room
  Object.values(updates[roomName]).forEach(client => client.controller.abort());

  delete updates[roomName];

  res.json({ ok: true });
})

app.get("/delete-client/:roomName/:clients", (req, res) => {
  const roomName = req.params.roomName;
  const clientCount = parseInt(req.params.clients ?? '0');

  for (let i = 0; i < clientCount; i++) {
    const clients = Object.keys(updates[roomName])
    let randomClientIndex = Math.floor(Math.random() * clients.length);

    const randomClient = clients[randomClientIndex]
    randomClient.controller.abort();
  }

  res.json({ ok: true });
})

app.get("/send-update/:roomName/:clientId", (req, res) => {
  const roomName = req.params.roomName;
  const clientId = req.params.clientId ?? '0';

  if (!Object.hasOwn(updates, roomName)) res.json({ ok: false, msg: "Room does not exist" })
  if (!Object.hasOwn(updates[roomName], clientId)) res.json({ ok: false, msg: "Client does not exit" })

  const client = updates[roomName][clientId];
  // tell the child process to send an update
  client.child.send({ action: 'message' });

  res.json({ ok: true });
})

const computeAverageLatency = roomName => {
  const childClients = Object.values(updates[roomName]);
  return childClients.
        reduce((totalLatency, currentClient) => 
          totalLatency + currentClient.delay, 0) 
        / childClients.length;
}

const stats = [];
app.get("/self-test-room/:clientCount/:updateCount", async (req, res) => {
  resetRoomAndClients();

  const clientCount = parseInt(req.params.clientCount ?? '10');
  const updateCount = parseInt(req.params.updateCount ?? '10');

  const roomName = crypto.randomUUID();

  // create a new room with two clients
  createRoom(roomName, 2);

  const latencyList = [];
  for (let i = 0; i < clientCount - 2; i++) {
    // create a new client
    const { childClient } = spawnChild(roomName, i + 2);
    let latencies = [];

    for (let j = 0; j < updateCount; j++) {
      childClient.send({ action: 'message' });
      // wait until message has been sent
      await new Promise((resolve, reject) => {
        childClient.on('message', message => {
          if (message.type === 'ack') resolve();
        });
      });
      latencies.push(computeAverageLatency(roomName));
    }
    
    // record the average latency
    latencyList.push({
      clientCount: Object.values(updates[roomName]).length,
      delay: latencies.reduce((acc, curr) => acc + curr, 0) / latencies.length,
    });

    // reset the array for the next calculation
    latencies = [];
  }

  stringify(latencyList, {
    header: true,
    columns: {
      clientCount: 'clientCount',
      delay: 'delay'
    }
  }, (err, out) => {
    if (err) res.json({ ok: false, msg: "Failed to create csv"})

    // write the output to a file
    writeFileSync("single-room.csv", out);
  })

  res.json({ ok: true });
})

const randomIndex = length => Math.floor(Math.random() * length);

app.get("/self-test-multiroom/:roomCount/:clientCount/:updateCount", async (req, res) => {
  resetRoomAndClients();

  const roomCount = parseInt(req.params.roomCount ?? '10');
  const clientCount = parseInt(req.params.clientCount ?? '10');
  const updateCount = parseInt(req.params.updateCount ?? '10');

  const [room1, room2] = new Array(2).fill(0).map(_ => crypto.randomUUID());
  createRoom(room1, 2);
  createRoom(room2, 2);

  let currentRoomCount = 2;
  let currentClientCount = 2;
  let latencies = [];

  const averageLatency = loadTestClients();
  latencies.push({ latency: averageLatency, roomCount });

  while (currentRoomCount != roomCount && currentClientCount != clientCount) {
    // increase if it hasn't reached the desired count
    currentClientCount += (currentClientCount < clientCount) ? 1 : 0;

    // increase the number of clients in every room
    const roomKeys = Object.keys(updates);
    roomKeys.forEach(roomKey => increaseClientCountsTo(roomKey, currentClientCount));

    latencies.push({ latency: loadTestClients(), roomCount: currentRoomCount, clientCount: currentClientCount });

    createRoom(crypto.randomUUID(), currentClientCount);
    // increase if it hasn't reached the desired count
    currentRoomCount += (currentRoomCount < roomCount) ? 1 : 0;

    latencies.push({ latency: loadTestClients(), roomCount: currentRoomCount, clientCount: currentClientCount });
  }

  function increaseClientCountsTo(roomName, count) {
    const newClientsCount = count - Object.keys(updates[roomName]).length;
    createRoom(roomName, newClientsCount);
  }

  function loadTestClients() {
    const latencies = [];
    const roomKeys = Object.keys(updates);

    roomKeys.forEach(async roomKey => {
      const clients = updates[roomKey];
      const clientValues = Object.values(clients) ;

      const randomClient = clientValues[randomIndex(clientValues.length)];

      const updatesLatency = [];
      for (let i = 0; i < updateCount; i++) {
        randomClient.child.send({ action: 'message' });

        // wait until we get acknowledgement from client that message was received 
        await new Promise((resolve, reject) => {
          randomClient.child.on("message", message => {
            if (message.type === 'ack') resolve();
          });
        })

        if (Number.isNaN(computeAverageLatency(roomKey))) throw new Error("Nan when computing update latency");
        updatesLatency.push(computeAverageLatency(roomKey));
      }
      // push average latency across <updateCount> updates
      latencies.push(
        updatesLatency.reduce((acc, curr) => acc + curr, 0) / updatesLatency.length
      );
      if (latencies.some(v => Number.isNaN(v))) throw new Error("NaN in room average latency");
    });

    // compute average latency across every room
    const averageLatency = latencies.reduce((acc, curr) => acc + curr, 0) / latencies.length;
    if (Number.isNaN(averageLatency)) throw Error("Average Latency here is NaN")
    return averageLatency;
  }

  stringify(latencies, {
    header: true,
    columns: {
      clientCount: 'clientCount',
      latency: 'latency',
      roomCount: 'roomCount'
    }
  }, (err, out) => {
    if (err) res.json({ ok: false, msg: "Failed to create csv" })

    // write the output to a file
    writeFileSync("multi-room.csv", out);
  })

  res.json({ ok: true });
})

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Listening on port", PORT));