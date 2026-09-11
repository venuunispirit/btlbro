import { google } from 'googleapis';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class GoogleDriveService {
  constructor() {
    this.oauth2Client = null;
    this.drive = null;
  }

  // Initialize OAuth2 client
  initClient() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  // Generate auth URL for OAuth consent
  getAuthUrl() {
    this.initClient();
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
      ],
      prompt: 'consent',
    });
  }

  // Exchange authorization code for tokens
  async getTokensFromCode(code) {
    this.initClient();
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  // Set credentials from stored tokens
  setCredentials(accessToken, refreshToken) {
    this.initClient();
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  // Extract folder ID from Google Drive URL
  extractFolderId(url) {
    if (!url) return null;

    // Handle various Google Drive URL formats
    const patterns = [
      /drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/drive\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/,
      /docs\.google\.com\/folders\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    // Try as direct folder ID
    if (/^[a-zA-Z0-9_-]+$/.test(url.trim())) {
      return url.trim();
    }

    return null;
  }

  // Extract file ID from Google Drive URL
  extractFileId(url) {
    if (!url) return null;
    const patterns = [
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
      /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
      /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // List files in a folder
  async listFiles(folderId) {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
        pageSize: 100,
        orderBy: 'modifiedTime desc',
      });
      return response.data.files || [];
    } catch (error) {
      console.error('Error listing files:', error.message);
      throw error;
    }
  }

  // Get file metadata
  async getFileMetadata(fileId) {
    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, modifiedTime, webViewLink',
      });
      return response.data;
    } catch (error) {
      console.error('Error getting file metadata:', error.message);
      throw error;
    }
  }

  // Download and parse CSV file
  async downloadCSV(fileId, fileName) {
    try {
      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      const content = Buffer.from(response.data).toString('utf-8');
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });

      return records;
    } catch (error) {
      console.error(`Error downloading CSV ${fileName}:`, error.message);
      throw error;
    }
  }

  // Download and parse Excel file
  async downloadExcel(fileId, fileName) {
    try {
      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      const buffer = Buffer.from(response.data);
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // Parse all sheets
      const allRecords = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(sheet);
        allRecords.push(...records);
      }

      return allRecords;
    } catch (error) {
      console.error(`Error downloading Excel ${fileName}:`, error.message);
      throw error;
    }
  }

  // Get records from a file based on type
  async getFileRecords(fileId, fileName, mimeType) {
    const csvTypes = ['text/csv', 'application/csv'];
    const excelTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/tab-separated-values',
    ];

    if (csvTypes.includes(mimeType) || fileName.endsWith('.csv')) {
      return await this.downloadCSV(fileId, fileName);
    }

    if (excelTypes.includes(mimeType) || fileName.match(/\.(xlsx?|tsv)$/i)) {
      return await this.downloadExcel(fileId, fileName);
    }

    // For other file types, return empty array
    return [];
  }

  // Verify connection by getting about info
  async verifyConnection() {
    try {
      const response = await this.drive.about.get({
        fields: 'user, storageQuota',
      });
      return {
        connected: true,
        user: response.data.user?.displayName || 'Unknown',
        storageUsed: response.data.storageQuota?.usage || 0,
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
      };
    }
  }
}

export default new GoogleDriveService();
