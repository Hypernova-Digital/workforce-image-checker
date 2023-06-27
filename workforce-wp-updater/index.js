const axios = require('axios');
const yargs = require('yargs/yargs');
const cheerio = require('cheerio');
const btoa = require('btoa');
const { hideBin } = require('yargs/helpers');
const sleep = require('util').promisify(setTimeout);

const { dryRun } = yargs(hideBin(process.argv)).argv;

const WP_API_URL = "https://stgnews.workforce.com/wp-json/wp/v2";
const WP_USER = "zachrussell";
const WP_PASSWORD = "CHH5 PDdZ SnVJ Mxw7 LRM3 danW";
const BASIC_AUTH = "Basic " + btoa(`${WP_USER}:${WP_PASSWORD}`);

let brokenImageCount = 0;
let workingImageCount = 0;

async function checkImage(url) {
  try {
    const response = await axios.head(url);
    if (response.status === 200) {
      workingImageCount++;
      return true;
    }
  } catch (error) {
    brokenImageCount++;
    console.log(`Broken image found: ${url}. Reason: ${error.message}`);
    return false;
  }
}

async function processPage(pageNumber) {
  try {
    console.log(`Processing page: ${pageNumber}`);
    const res = await axios.get(`${WP_API_URL}/posts?page=${pageNumber}`);
    if (res.data.length === 0) {
      console.log(`No more posts on page: ${pageNumber}`);
      return false;
    }

    for (const post of res.data) {
      const $ = cheerio.load(post.content.rendered);
      const imgTags = $("img");

      for (let i = 0; i < imgTags.length; i++) {
        const imgTag = imgTags[i];
        const imageUrl = $(imgTag).attr("src");

        if (!(await checkImage(imageUrl)) && !dryRun) {
          const parent = $(imgTag).parent();
          if (parent.is("a")) {
            parent.remove();
            console.log(`Removed broken image surrounded by an "a" tag: ${imageUrl}`);
          } else {
            $(imgTag).remove();
          }

          const updatedPostContent = $.html();
          await axios.put(
            `${WP_API_URL}/posts/${post.id}`,
            { content: updatedPostContent },
            { headers: { Authorization: BASIC_AUTH } }
          );
          console.log(`Updated post ID ${post.id}. Full URL: https://stgnews.workforce.com/?p=${post.id}`);

          // Wait for 5 seconds before next request
          await sleep(5000);
        }
      }
    }

    return true;
  } catch (error) {
    console.error(`Error processing page ${pageNumber}: `, error);
  }
}

async function processPosts() {
  let page = 1;
  while (await processPage(page)) {
    page++;
  }

  console.log(`Total broken images: ${brokenImageCount}`);
  console.log(`Total working images: ${workingImageCount}`);
}

processPosts();

