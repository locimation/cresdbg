// Constants to identify file types
const RLSIG0001 = 1;
const LOGOSSIG001 = 2;

function parseCrestronSigFile(file) {
  const buffer = file;

  // We'll maintain an offset that we move through the buffer
  let offset = 0;
  let sigFileTypeString = "";

  // 1) Read the header until we hit a `]`
  while (offset < buffer.length) {
    const byte = buffer[offset++];
    if (byte === undefined) break; // Safety check
    sigFileTypeString += String.fromCharCode(byte);

    if (sigFileTypeString.endsWith("]")) {
      break;
    }
  }

  // 2) Identify which SIG format we have
  let sigFileType = null;
  if (sigFileTypeString === "[RLSIG0001]") {
    sigFileType = RLSIG0001;
  } else if (sigFileTypeString === "[LOGOSSIG001.000]") {
    sigFileType = LOGOSSIG001;
  } else {
    console.error("Unknown sig file type:", sigFileTypeString);
    return {};
  }

  // 3) Start reading signal records
  const signals = {};

  // Helper to safely read a chunk of the buffer
  function readBytes(count) {
    if (offset + count > buffer.length) {
      throw new Error("Attempt to read beyond end of buffer");
    }
    const chunk = buffer.slice(offset, offset + count);
    offset += count;
    return chunk;
  }

  try {
    while (offset < buffer.length) {
      // (a) Read a 2-byte integer (signed) for the record length
      const lengthBuf = readBytes(2);
      const recordLen = lengthBuf.readInt16LE(0);

      // In your Python code, it does `sig_name_len = unpack("h", f.read(2))[0] - 8`
      // so we mimic that:
      const sigNameLen = recordLen - 8;
      if (sigNameLen <= 0) {
        // Reached invalid or end-of-data
        break;
      }

      // (b) Read the signal name
      const nameBuf = readBytes(sigNameLen);

      let signalName;
      if (sigFileType === RLSIG0001) {
        // RLSIG0001 => likely ASCII
        signalName = nameBuf.toString("ascii");
      } else {
        // LOGOSSIG001 => likely UTF-16 little-endian
        signalName = nameBuf.toString("utf-16le");
      }

      // (c) Read the signal index (4 bytes, unsigned int)
      const indexBuf = readBytes(4);
      const sigIndex = indexBuf.readUInt32LE(0);

      // (d) Read 1 byte for type, 1 byte for flags
      const typeByte = readBytes(1)[0];  // e.g. 0 = digital, 1 = analog, 2 = serial
      const flagsByte = readBytes(1)[0]; // 0x?? - depends on Crestron’s internal usage

      // Convert typeByte to a more readable string for demonstration
      let signalType = "unknown";
      if (typeByte === 0x00) {
        signalType = "digital";
      } else if (typeByte === 0x01) {
        signalType = "analog";
      } else if (typeByte === 0x02) {
        signalType = "serial";
      }

      // Store in our signals object
      // You asked for: { my_signal_name: { number: 2, type: "analog" } }
      signals[signalName] = {
        number: sigIndex,
        type: signalType,
        // you could also store flags if you want:
        // flags: flagsByte
      };
    }
  } catch (err) {
    // Often you’ll hit an error when you pass the end of file,
    // or if the file structure doesn’t match exactly.
    // We'll just ignore it or console.log it:
    // console.error("Parse error:", err);
  }

  return signals;
}

// Export the function if you want to require it in other modules
module.exports = {
  parseCrestronSigFile
};
