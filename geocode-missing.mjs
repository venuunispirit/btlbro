import https from 'https';
import fs from 'fs';

function geocode(name) {
  return new Promise((resolve) => {
    const q = encodeURIComponent(name + ', Bengaluru, India');
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q;
    https.get(url, { headers: { 'User-Agent': 'BTLbro/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j[0]) resolve({ lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) });
          else resolve(null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

const missing = [
  'The Bangalore Cafe, Shanti Nagar',
  'Matteo Coffea, Church Street',
  "Glen's Bakehouse, Indiranagar",
  'The Kind Roastery and Brew Room, Indiranagar',
  'Cafe Noir, UB City',
];

const db = JSON.parse(fs.readFileSync('./server/data/db.json', 'utf8'));
const records = db.records || [];

async function run() {
  for (const name of missing) {
    const coords = await geocode(name);
    console.log(name, '->', coords ? `${coords.lat}, ${coords.lng}` : 'NOT FOUND');
    if (coords) {
      const rec = records.find(r => r.data && r.data.name === name);
      if (rec) {
        rec.data.lat = coords.lat;
        rec.data.lng = coords.lng;
        console.log('  Updated record id:', rec.id);
      } else {
        console.log('  Record not found in DB');
      }
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  fs.writeFileSync('./server/data/db.json', JSON.stringify(db, null, 2));
  console.log('DB saved.');
}

run();
