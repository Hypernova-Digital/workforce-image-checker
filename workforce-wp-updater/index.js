const axios = require('axios');
const yargs = require('yargs/yargs');
const btoa = require('btoa');
const { hideBin } = require('yargs/helpers');
const sleep = require('util').promisify(setTimeout);

const { dryRun, postId } = yargs(hideBin(process.argv)).argv;

const WP_API_URL = "https://stgnews.workforce.com/wp-json/wp/v2";
const WP_USER = "zachrussell";
const WP_PASSWORD = "CHH5 PDdZ SnVJ Mxw7 LRM3 danW";
const BASIC_AUTH = "Basic " + btoa(`${WP_USER}:${WP_PASSWORD}`);

let brokenImageCount = 0;
let fixedImageCount = 0;
let workingImageCount = 0;

async function checkImage(url) {
  // If the URL is a relative URL, prepend the new domain
  if (url.startsWith('/')) {
    url = `https://stgnews.workforce.com${url}`;
  }

  // Variable that checks if the URL includes the old domain
  let urlIncludesOldDomain = url.includes('www.workforce.com') || url.includes('admin.workforce.com') || url.includes('workforce.com');

  // If the URL includes the old domain, a new URL is generated
  if (urlIncludesOldDomain) {
    let newUrl = url;
    newUrl = newUrl.replace('www.workforce.com', 'stgnews.workforce.com');
    newUrl = newUrl.replace('admin.workforce.com', 'stgnews.workforce.com');
    newUrl = newUrl.replace(/(?<!www.|stgnews.)workforce.com/g, 'stgnews.workforce.com');

    try {
      const response = await axios.head(newUrl, { maxRedirects: 0 });
      
      // If the request is successful and the new URL is different, the URL is fixed and logged
      if (response.status === 200 && newUrl !== url) {
        fixedImageCount++;
        console.log(`Fixed broken URL: ${url} to ${newUrl}`);
        return newUrl;
      } else if (response.status === 200) {
        workingImageCount++;
        console.log(`Working image found: ${newUrl}`);
        return newUrl;
      }
    } catch (error) {
      console.log(`Broken image found: ${newUrl}. Reason: ${error.message}`);
      brokenImageCount++;
      return false;
    }
  } else {
    // If the URL does not include the old domain, we make a HEAD request to the original URL
    try {
      const response = await axios.head(url, { maxRedirects: 0 });

      // If the request is successful, the URL is working and logged
      if (response.status === 200) {
        workingImageCount++;
        console.log(`Working image found: ${url}`);
        return url;
      }
    } catch (error) {
      console.log(`Broken image found: ${url}. Reason: ${error.message}`);
      brokenImageCount++;
      return false;
    }
  }
}


async function processSinglePost(postId) {
  console.log(`------------------- Start processing post ID: ${postId} -------------------`);
  try {
    const res = await axios.get(`${WP_API_URL}/posts/${postId}`);
    const post = res.data;

    let modifiedContent = post.content.rendered;

    const imgRegex = /<img[^>]*>/gi;
    const linkWithImgRegex = /<a[^>]*>(.*?<img[^>]*>.*?)<\/a>/gi;

    const imgMatches = modifiedContent.match(imgRegex) || [];
    const linkWithImgMatches = modifiedContent.match(linkWithImgRegex) || [];

    for (const match of linkWithImgMatches) {
      const originalUrl = getUrlFromImgTag(match);
      const newUrl = await checkImage(originalUrl);
      if (newUrl !== true && newUrl !== false && !dryRun) {
        modifiedContent = modifiedContent.replace(originalUrl, newUrl);
        console.log(`Replaced image source in a-tag from ${originalUrl} to ${newUrl}`);
      } else if (newUrl === false) {
        modifiedContent = modifiedContent.replace(match, ''); // remove the entire match
        console.log(`Removed broken image surrounded by an "a" tag: ${originalUrl}`);
      }
    }

    for (const match of imgMatches) {
      const originalUrl = getUrlFromImgTag(match);
      const newUrl = await checkImage(originalUrl);
      if (newUrl !== true && newUrl !== false && !dryRun) {
        modifiedContent = modifiedContent.replace(originalUrl, newUrl);
        console.log(`Replaced image source from ${originalUrl} to ${newUrl}`);
      } else if (newUrl === false) {
        modifiedContent = modifiedContent.replace(match, ''); // remove the entire match
        console.log(`Removed broken image: ${originalUrl}`);
      }
    }

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
      console.log(`------------------- Start processing post ID: ${post.id} URL: ${post.link} -------------------`);
      
      let modifiedContent = post.content.rendered;

      // Regular expressions to find <img> and <IMG> tags
      const imgRegex = /<img[^>]*>/gi;
      
      // Regular expressions to find <a> tags surrounding <img> and <IMG> tags
      const linkWithImgRegex = /<a[^>]*>(.*?<img[^>]*>.*?)<\/a>/gi;

      const imgMatches = modifiedContent.match(imgRegex) || [];
      const linkWithImgMatches = modifiedContent.match(linkWithImgRegex) || [];

      // If there's a broken image surrounded by an "a" tag, replace the image URL
      for (const match of linkWithImgMatches) {
        const originalUrl = getUrlFromImgTag(match);
        const newUrl = await checkImage(originalUrl);
        if (newUrl !== true && newUrl !== false && !dryRun) {
          modifiedContent = modifiedContent.replace(originalUrl, newUrl);
          console.log(`Replaced image source in a-tag from ${originalUrl} to ${newUrl}`);
        } else if (newUrl === false) {
          modifiedContent = modifiedContent.replace(match, ''); // remove the entire match
          console.log(`Removed broken image surrounded by an "a" tag: ${originalUrl}`);
        }
      }

      // If there's a broken image tag, replace the image URL
      for (const match of imgMatches) {
        const originalUrl = getUrlFromImgTag(match);
        const newUrl = await checkImage(originalUrl);
        if (newUrl !== true && newUrl !== false && !dryRun) {
          modifiedContent = modifiedContent.replace(originalUrl, newUrl);
          console.log(`Replaced image source from ${originalUrl} to ${newUrl}`);
        } else if (newUrl === false) {
          modifiedContent = modifiedContent.replace(match, ''); // remove the entire match
          console.log(`Removed broken image: ${originalUrl}`);
        }
      }

      // Update the post with the modified content
      if (modifiedContent !== post.content.rendered && !dryRun) {
        const updatedPostResponse = await axios.put(
          `${WP_API_URL}/posts/${post.id}`,
          { content: modifiedContent },
          { headers: { Authorization: BASIC_AUTH } }
        );
        console.log(`Updated post ID: ${post.id}. Full URL: ${updatedPostResponse.data.link}`);

        console.log('Waiting for 30 seconds before processing the next post...');
        await sleep(.2 * 60 * 1000);
      }

      console.log(`------------------- End processing post ID: ${post.id} URL: ${post.link} -------------------`);
    }

    console.log(`========================== End processing page: ${pageNumber} ==========================`);

    return true;
  } catch (error) {
    console.error(`Error processing page ${pageNumber}: `, error);
  }
}

function getUrlFromImgTag(imgTag) {
  const srcMatch = imgTag.match(/src="([^"]*)"/i);  // using 'i' flag to make it case insensitive
  return srcMatch ? srcMatch[1] : '';
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

  console.log(`Total broken images: ${brokenImageCount}`);
  console.log(`Total fixed images: ${fixedImageCount}`);
  console.log(`Total working images: ${workingImageCount}`);

  console.log('=============== End processing posts ===============');
}

processPosts();

