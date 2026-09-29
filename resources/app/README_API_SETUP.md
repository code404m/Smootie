# YouTube API Key Setup Guide

To enable YouTube thumbnail detection when the URL is missing, you need to set up a YouTube Data API v3 key.

## Step 1: Get a YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **YouTube Data API v3**:
   - Go to "APIs & Services" > "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"
4. Create credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy your API key

## Step 2: Set Up the API Key

### Option A: Using .env file (Recommended)

1. Copy `.env.example` to `.env`:
   ```powershell
   copy .env.example .env
   ```

2. Open `.env` in a text editor and replace `your_api_key_here` with your actual API key:
   ```
   YOUTUBE_API_KEY=AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

3. The app will automatically load the API key from the `.env` file when you run `npm start`

### Option B: Using PowerShell Environment Variable

Run this command in PowerShell before starting the app:
```powershell
$env:YOUTUBE_API_KEY="your_api_key_here"
npm start
```

### Option C: Set Permanently in Windows

1. Open System Properties > Environment Variables
2. Add a new User variable:
   - Name: `YOUTUBE_API_KEY`
   - Value: `your_api_key_here`
3. Restart your terminal/IDE and run `npm start`

## Step 3: Verify It's Working

After setting up the API key, restart the app and open a YouTube video. You should see:
- Thumbnails appearing in the album square
- Console logs showing `[youtube] Successfully resolved: [videoId] [thumbnailUrl]`

## Troubleshooting

- Make sure the API key is correct (no extra spaces)
- Ensure "YouTube Data API v3" is enabled in your Google Cloud project
- Check that your API key has the correct permissions
- The `.env` file should be in the same directory as `package.json`




