import { google } from "googleapis";
import { prisma } from "./prisma";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
  const oauth = getOAuth2Client();
  return oauth.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function getTokenFromCode(code: string) {
  const oauth = getOAuth2Client();
  const { tokens } = await oauth.getToken(code);
  return tokens;
}

export async function getAuthenticatedClient(userId: string) {
  const token = await prisma.googleToken.findUnique({ where: { userId } });
  if (!token) return null;

  const oauth = getOAuth2Client();
  oauth.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken ?? undefined,
    expiry_date: token.expiresAt?.getTime(),
  });

  oauth.on("tokens", async (newTokens) => {
    const data: any = {};
    if (newTokens.access_token) data.accessToken = newTokens.access_token;
    if (newTokens.refresh_token) data.refreshToken = newTokens.refresh_token;
    if (newTokens.expiry_date) data.expiresAt = new Date(newTokens.expiry_date);
    await prisma.googleToken.update({ where: { userId }, data });
  });

  return oauth;
}

export async function getDriveService(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

export async function getSheetsService(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return null;
  return google.sheets({ version: "v4", auth });
}

export async function getSlidesService(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return null;
  return google.slides({ version: "v1", auth });
}

export async function listDriveFiles(userId: string, folderId?: string) {
  const drive = await getDriveService(userId);
  if (!drive) return null;

  const folderQuery = folderId
    ? `'${folderId}' in parents`
    : "sharedWithMe = true";

  const res = await drive.files.list({
    q: `${folderQuery} and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.presentation') and trashed=false`,
    fields: "files(id, name, mimeType, webViewLink, iconLink, size, createdTime, modifiedTime, owners)",
    orderBy: "modifiedTime desc",
    pageSize: 50,
  });

  return res.data.files || [];
}

export async function createSheet(
  userId: string,
  title: string,
  data: { headers: string[]; rows: string[][] }
) {
  const sheets = await getSheetsService(userId);
  if (!sheets) return null;

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [data.headers, ...data.rows],
    },
  });

  return { spreadsheetId, url: spreadsheet.data.spreadsheetUrl };
}

export async function createOrUpdateSlide(
  userId: string,
  title: string,
  slideId?: string
) {
  const slides = await getSlidesService(userId);
  if (!slides) return null;

  if (slideId) {
    await slides.presentations.get({ presentationId: slideId });
    return { presentationId: slideId, url: `https://docs.google.com/presentation/d/${slideId}/edit` };
  }

  const presentation = await slides.presentations.create({
    requestBody: { title },
  });

  const presId = presentation.data.presentationId!;
  return {
    presentationId: presId,
    url: `https://docs.google.com/presentation/d/${presId}/edit`,
  };
}

export async function readSheetData(userId: string, spreadsheetId: string, range?: string) {
  const sheets = await getSheetsService(userId);
  if (!sheets) return null;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: range || "Sheet1",
  });

  const values = res.data.values || [];
  if (values.length < 2) return { headers: values[0] || [], rows: [] };

  return {
    headers: values[0],
    rows: values.slice(1),
  };
}

export function getEmbedUrl(fileId: string, mimeType: string) {
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return `https://docs.google.com/presentation/d/${fileId}/preview`;
  }
  return `https://docs.google.com/file/d/${fileId}/preview`;
}
