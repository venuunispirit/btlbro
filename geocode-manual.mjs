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

// Known Bengaluru area coordinates for these locations based on their area names
const manualCoords = {
  'The Bangalore Cafe, Shanti Nagar': { lat: 12.9591, lng: 77.5975 }, // Shanti Nagar area
  'Matteo Coffea, Church Street':     { lat: 12.9754, lng: 77.6069 }, // Church Street
  'The Kind Roastery and Brew Room, Indiranagar': { lat: 12.9784, lng: 77.6408 }, // Indiranagar
  'Cafe Noir, UB City':               { lat: 12.9718, lng: 77.5964 }, // UB City
};

const db = JSON.parse(fs.readFileSync('./server/data/db.json', 'utf8'));
const records = db.records || [];

for (const [name, coords] of Object.entries(manualCoords)) {
  const rec = records.find(r => r.data && r.data.name === name);
  if (rec) {
    rec.data.lat = coords.lat;
    rec.data.lng = coords.lng;
    console.log('Updated:', name, '->', coords.lat, coords.lng);
  } else {
    console.log('NOT FOUND in DB:', name);
  }
}

fs.writeFileSync('./server/data/db.json', JSON.stringify(db, null, 2));
console.log('DB saved.');
