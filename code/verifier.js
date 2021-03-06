//////////////////////////////////////////////////////////
// Verifier verification-app
// (c) A.J. Wischmann 2021
//////////////////////////////////////////////////////////
"use strict";

const { mamFetchAll, TrytesHelper } = require("@iota/mam.js");
const { Converter } = require("@iota/iota.js");
const { sha256, utf8ToBuffer, bufferToHex } = require("eccrypto-js");
const luxon = require("luxon");
const fs = require("fs");
const prompt = require("prompt-sync")({ sigint: true });
const colors = require("colors");
const fetch = require("node-fetch");
const crypto = require("crypto");

const node = "https://chrysalis-nodes.iota.org/";
const commonSideKey =
  "SSACOMMONKEY9SSACOMMONKEY9SSACOMMONKEY9SSACOMMONKEY9SSACOMMONKEY9SSACOMMONKEY9SSA";
let publicEventRoot = "";
let attendeeToken = "";
let qrTime = "";
let eventInformation = "";
let mamClosedTime = "";
let personalInfo = "";
let publicCID = "";
let attendeeCID = "";
let storageKey = "";

async function hashHash(hashData) {
  let element = await sha256(utf8ToBuffer(hashData));
  return bufferToHex(element);
}

function getEventInfo(mamData) {
  // convert from MAM to JSON
  let fMessage = JSON.parse(TrytesHelper.toAscii(mamData.message));
  return fMessage;
}

function decryptAES(data, ivEnc, pass) {

  const key = Buffer.from(pass, 'hex');
  const toDecipher = data;
  const iv = Buffer.from(ivEnc, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(pass, 'hex'), iv);

  const decryptedData = decipher.update(toDecipher, 'hex', 'utf8') + decipher.final('utf8');
  return decryptedData;
}

async function retrieveCID(targetCID) {
  const url = "https://gateway.pinata.cloud/ipfs/".concat(targetCID);
  let retrieved;
  await fetch(url)
    .then(res => res.json())
    .then(json => { retrieved = JSON.stringify(json) });
  return retrieved;
}

async function getIPFSData(targetCID, decryptKey) {
  let ipfsData = JSON.parse(await retrieveCID(targetCID));

  let encryptedData = ipfsData.a;
  let hexIV = ipfsData.b;

  let eventInfo = JSON.parse(decryptAES(encryptedData, hexIV, decryptKey));
  return eventInfo;
}

// readAttendeeQR
function readQR() {
  // Try and load the QR-root from file - as substitute for QRscan from camera
  try {
    const data = fs.readFileSync("./json/verifierQR.json", "utf8");
    return data;
  } catch (err) { }
}

async function checkIPFS(code) {
  // check integrity of QR-code

  let codeLength = code.length;
  if (codeLength > 239) {
    // length indicates personalInformation is included
    personalInfo = code.slice(0, codeLength - 239);
    code = code.slice(-239);
  }
  let crccode = code.slice(-5);
  let idToken = code.slice(0,65);
  let idstring = degarble(idToken).toLowerCase();
  let pubCID = code.slice(65, 111);
  let attCID = code.slice(111, 157);
  let storeKey = code.slice(157, 221);
  let timecode = code.slice(-18, -5);
  let rest = idToken + pubCID + attCID + storeKey + timecode + personalInfo + "SSAsaltQ3v%";
  //DEBUGINFO
  //   console.log(`crccode :${crccode}`);
  //   console.log(`idstring :${idstring}`);
  //   console.log(`rootcode :${rootcode}`);
  //   console.log(`timecode :${timecode}`);
  //   console.log(`rest :${rest}`);

  let crcValueString = await hashHash(rest);
  let crcValue = crcValueString.slice(-5);
  if (crccode == crcValue) {
    publicCID = pubCID;
    attendeeCID = attCID;
    storageKey = storeKey;
    attendeeToken = await hashHash(idstring);
    // console.log(`attendeeToken :${attendeeToken}`);
    qrTime = luxon.DateTime.fromMillis(parseInt(timecode));
    let nowTime = luxon.DateTime.now();
    let timeDiff = nowTime.diff(qrTime);
    if (timeDiff.as(`minutes`) > 5)
      console.log(
        `Suspicious behaviour : QR-code is older than 5 minutes!`.underline
          .brightRed
      );
    console.log(
      `QR-code was generated ${parseInt(
        timeDiff.as(`minutes`)
      )} minutes ago at: ${qrTime.toISO()}`.yellow
    );
    return true;
  }
  console.log("-- QR code is incorrect! --".red);
  return false;
}

async function checkQR(code) {
  // check integrity of QR-code

  let codeLength = code.length;
  if (codeLength > 164) {
    // length indicates personalInformation is included
    personalInfo = code.slice(0, codeLength - 164);
    code = code.slice(-164);
  }
  code = degarble(code);
  let crccode = code.slice(-5).toLowerCase();
  let idstring = code.slice(0, 64).toLowerCase();
  let rootcode = code.slice(64, -18);
  let timecode = code.slice(-18, -5);
  let rest = idstring + rootcode + timecode + personalInfo + "SSAsaltQ3v%";
  //DEBUGINFO
  //   console.log(`crccode :${crccode}`);
  //   console.log(`idstring :${idstring}`);
  //   console.log(`rootcode :${rootcode}`);
  //   console.log(`timecode :${timecode}`);
  //   console.log(`rest :${rest}`);

  let crcValueString = await hashHash(rest);
  let crcValue = crcValueString.slice(-5);
  if (crccode == crcValue) {
    publicEventRoot = rootcode;
    attendeeToken = await hashHash(idstring);
    // console.log(`attendeeToken :${attendeeToken}`);
    qrTime = luxon.DateTime.fromMillis(parseInt(timecode));
    let nowTime = luxon.DateTime.now();
    let timeDiff = nowTime.diff(qrTime);
    if (timeDiff.as(`minutes`) > 5)
      console.log(
        `Suspicious behaviour : QR-code is older than 5 minutes!`.underline
          .brightRed
      );
    console.log(
      `QR-code was generated ${parseInt(
        timeDiff.as(`minutes`)
      )} minutes ago at: ${qrTime.toISO()}`.yellow
    );
    return true;
  }
  console.log("-- QR code is incorrect! --".red);
  return false;
}

async function readWholeMam(startingRoot) {
  // read ALL Mamrecords into memory
  const mode = "restricted";
  const sideKey = commonSideKey;

  console.log("Fetching eventinformation....".yellow);
  const fetched = await mamFetchAll(node, startingRoot, mode, sideKey);
  return fetched;
}

function mamStillOpenStatus(allMamData) {
  // check if event was already closed or stil open
  let mamOpenStatus = true;
  for (let i = 0; i < allMamData.length; i++) {
    const element = allMamData[i].message;
    let mamRecord = JSON.parse(TrytesHelper.toAscii(element));
    if (mamRecord.message == "Event closed") {
      mamOpenStatus = false;
      mamClosedTime = mamRecord.date;
    }
  }
  return mamOpenStatus;
}

function presentEventInfo(eventRecord) {
  console.log("Eventinformation =================================".red);
  console.log("Event :".cyan);
  console.log(`Name : ${eventRecord.eventname}`);
  console.log(`Date : ${eventRecord.eventdate}`);
  console.log(`Time : ${eventRecord.eventtime}`);
  console.log(`Location : ${eventRecord.eventloc}`);
  console.log("=================================".red);
  console.log("Organised by :".cyan);
  console.log(`Organisation : ${eventRecord.orgname}`);
  console.log(`Address : ${eventRecord.orgaddress}`);
  console.log(`Zipcode : ${eventRecord.orgzip}`);
  console.log(`City : ${eventRecord.orgcity}`);
  console.log(`Tel.nr. : ${eventRecord.orgtel}`);
  console.log(`E-mail : ${eventRecord.orgmail}`);
  console.log(`WWW : ${eventRecord.orgurl}`);
  console.log(`DID : ${eventRecord.orgdid}`);
  console.log("=================================".red);
}

function loadAttendeeTokens(mamAttendeeMessage) {
  // readAttendeeList -till ClosedMessage
  let aList = [];

  let fMessage = getEventInfo(mamAttendeeMessage);
  aList = aList.concat(fMessage.ids);
  // console.log("attendeeList ========");
  // console.log(`aList : ${aList}`.yellow);

  return aList;
}

function checkAttended(ID, idList) {
  // check if attendeeID is on the list of registeredIDs
  if (idList.indexOf(ID) === -1) {
    console.log(`ID : ${ID} was NOT registered at this event!`.brightRed);
    return false;
  } else {
    console.log(`ID : ${ID} has attended this event.`.green);
    return true;
  }
}

function degarble(txt) {
  // decrypts and unshifts

  let base = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let dict = "5TXY6VWD8BEF7CUHI2RSZ34LM9ANOGJK01PQ";
  let key = txt.slice(-1);
  let cipherwaarde = dict.indexOf(key);

  let z = "";
  for (let i = 0; i < txt.length - 1; i++) {
    let letter = dict.indexOf(txt[i]) - cipherwaarde;
    if (letter < 0) letter += 36;
    z += base[letter];
  }
  let shifter = cipherwaarde % 31;
  let arretje = z.split("");
  for (let s = 0; s < shifter; s++) {
    let l = arretje.pop();
    arretje.unshift(l);
  }
  z = arretje.join("");
  return z;
}

async function run() {
  console.log("SSA-verifier-app".cyan);
  let verificationQR = readQR();
  console.log(`VerificationQR : ${verificationQR}`.green);
  let eventQR = prompt("Verification QR-code (*=savedversion): ");
  if (eventQR === "*") eventQR = verificationQR;
  let ipfsQR = false;
  let menuChoice = prompt(
    `IPFS QR code? [y,N] :`.yellow
  );
  if (menuChoice.toUpperCase() === "Y") ipfsQR = true;

  let qrOkay;
  if (ipfsQR) {
    qrOkay = await checkIPFS(eventQR);
  } else {
    qrOkay = await checkQR(eventQR);
  }
  if (!qrOkay) {
    console.log("-- Verification aborted --".red);
    return;
  } else {
    if (ipfsQR) {
      let eventInformation = await getIPFSData(publicCID, storageKey);
      let attList = await getIPFSData(attendeeCID, storageKey);

      if (eventInformation.eventPublicKey.length > 0) {
        // show eventinfo
        presentEventInfo(eventInformation);
        let attendeeList = [];
        attendeeList = attendeeList.concat(JSON.parse(attList).ids);
        // checkAttendeeOnList
        if (personalInfo) {
          console.log(
            `Included personalinformation : ${personalInfo.slice(0, -2)}`.yellow
          );
        } else {
          console.log(`NO personal information was included`.red);
        }

        checkAttended(attendeeToken, attendeeList);

      }

    } else {
      // readEventInfo
      let allMamData = await readWholeMam(publicEventRoot);
      eventInformation = getEventInfo(allMamData[0]);
      if (eventInformation.eventPublicKey.length > 0) {
        // show eventinfo
        presentEventInfo(eventInformation);
        if (mamStillOpenStatus(allMamData)) {
          console.log(
            `Event registration is open at this moment, no check possible.`
              .brightRed
          );
          return;
        }
        console.log(`The event registration was closed at : ${mamClosedTime}`);

        const attendeeList = loadAttendeeTokens(allMamData[1]);
        // checkAttendeeOnList
        if (personalInfo) {
          console.log(
            `Included personalinformation : ${personalInfo.slice(0, -2)}`.yellow
          );
        } else {
          console.log(`NO personal information was included`.red);
        }

        checkAttended(attendeeToken, attendeeList);

      }
    }
  }
}

run();
