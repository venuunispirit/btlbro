import React, { useState, useRef } from 'react';
import { Upload, Image, Trash2, Copy, Check } from 'lucide-react';
import { uploadImage } from '../api.js';
import { useFeedback } from '../components/Feedback.jsx';
import { EmptyState } from '../theme.js';

export default function UploadsTab() {
  const { toast, notify } = useFeedback();
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(null);
  const inputRef = useRef(null);

  async function handleUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      try {
        const res = await uploadImage(file);
        setImages(prev => [{ url: res.url, name: file.name, size: file.size }, ...prev]);
      } catch (err) {
        notify(err.message);
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function copyUrl(url) {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => inputRef.current?.click()} disabled={uploading} style={{
          padding: '10px 20px', borderRadius: 8, border: 'none', background: '#F2701D',
          color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload Images'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleUpload} style={{ display: 'none' }} />
        <span style={{ fontSize: 12, color: '#949494' }}>Upload images for products, website sections, etc.</span>
      </div>

      {images.length === 0 ? (
        <EmptyState
          icon={<Image size={30} color="#C9C2B4" />}
          title="No images uploaded yet"
          hint="Use “Upload Images” to add images from your computer. They become available to products and website sections."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {images.map((img, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #F1EDE4' }}>
              <img src={img.url} alt={img.name} style={{ width: '100%', height: 140, objectFit: 'cover' }} />
              <div style={{ padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</div>
                <div style={{ fontSize: 11, color: '#949494', marginTop: 2 }}>{formatSize(img.size)}</div>
                <button onClick={() => copyUrl(img.url)} style={{
                  marginTop: 8, width: '100%', padding: 6, borderRadius: 6, border: '1px solid #E7E2D8',
                  background: '#fff', fontSize: 11, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  {copied === img.url ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Copy URL</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
