const axios = require('axios');
const yargs = require('yargs/yargs');
const btoa = require('btoa');
const { hideBin } = require('yargs/helpers');
const sleep = require('util').promisify(setTimeout);

const { dryRun, postId } = yargs(hideBin(process.argv)).argv;

const WP_API_URL = "https://workforce.com/wp-json/wp/v2";
const WP_USER = "zachrussell";
const WP_PASSWORD = "0Otd HmVW x35L pt7C fc78 NFfz";
const BASIC_AUTH = "Basic " + btoa(`${WP_USER}:${WP_PASSWORD}`);

let changedTagCount = 0;
let httpsFixCount = 0;

async function processSinglePost(postId) {
  console.log(`------------------- Start processing post ID: ${postId} -------------------`);
  try {
    const res = await axios.get(`${WP_API_URL}/posts/${postId}`);
    const post = res.data;

    let modifiedContent = post.content.rendered;

    // Regex for H1 tags
    const h1Regex = /<h1[^>]*>(.*?)<\/h1>/gi;
    
    // Replace H1 tags with H2 tags
    if(h1Regex.test(modifiedContent)) {
      modifiedContent = modifiedContent.replace(h1Regex, '<h2>$1</h2>');
      changedTagCount++;
      console.log(`Replaced h1 tags with h2 tags in post ID: ${postId}`);
    }

    // Regex for links with workforce.com domain
    const linkRegex = /<a[^>]*href="(http:)?\/\/([^"]*workforce\.com)[^"]*"[^>]*>(.*?)<\/a>/gi;

    // Replace http with https
    modifiedContent = modifiedContent.replace(linkRegex, function(match, p1, p2, p3, offset, string) {
      const newMatch = match.replace('http://', 'https://');
      if (newMatch !== match) {
        httpsFixCount++;
        console.log(`Fixed HTTP link to HTTPS in post ID: ${postId}`);
      }
      return newMatch;
    });

    // Update the post with the modified content
    if (modifiedContent !== post.content.rendered && !dryRun) {
      const updatedPostResponse = await axios.put(
        `${WP_API_URL}/posts/${postId}`,
        { content: modifiedContent },
        { headers: { Authorization: BASIC_AUTH } }
      );
      console.log(`Updated post ID: ${postId}. Full URL: ${updatedPostResponse.data.link}`);
    }

  } catch (error) {
    console.error(`Error processing post ${postId}: `, error);
  }
  console.log(`------------------- End processing post ID: ${postId} -------------------`);
}

async function processPage(pageNumber) {
  console.log(`========================== Start processing page: ${pageNumber} ==========================`);

  try {
    const res = await axios.get(`${WP_API_URL}/posts?page=${pageNumber}`);
    if (res.data.length === 0) {
      console.log(`No more posts on page: ${pageNumber}`);
      return false;
    }

    for (const post of res.data) {
      await processSinglePost(post.id);
    }

    console.log(`========================== End processing page: ${pageNumber} ==========================`);

    return true;
  } catch (error) {
    console.error(`Error processing page ${pageNumber}: `, error);
  }
}

async function processPosts() {
  console.log('=============== Start processing posts ===============');
  
  if (postId) {
    await processSinglePost(postId);
  } else {
    let page = 1;
    while (await processPage(page)) {
      page++;
    }
  }

  console.log(`Total h1 tags changed to h2: ${changedTagCount}`);
  console.log(`Total HTTP links fixed to HTTPS: ${httpsFixCount}`);

  console.log('=============== End processing posts ===============');
}

processPosts();

