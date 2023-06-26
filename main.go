package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

var (
	baseURL     string
	username    string
	password    string
	dryRun      bool
	validCount  int
	brokenCount int
)

var baseUpdateURL string

func init() {
	flag.StringVar(&baseURL, "url", "", "URL of the WordPress site")
	flag.StringVar(&username, "user", "", "Username for Basic Auth")
	flag.StringVar(&password, "pass", "", "Password for Basic Auth")
	flag.BoolVar(&dryRun, "dry-run", false, "Dry run mode: check images but don't update posts")
	flag.Parse()
}

// Main function starts the execution of the script.
// It fetches posts from the WP REST API, parses the HTML content, and removes broken images.
// It also updates the post content with the modified HTML using WP REST API if not in dry-run mode.
func main() {
	page := 1

	// URL format validation.
	u, err := url.Parse(baseURL)
	if err != nil {
		fmt.Printf("Invalid URL format: %v\n", err)
		return
	}

	if !strings.HasSuffix(u.Path, "/") {
		u.Path += "/"
	}

	baseURL = u.String() + "wp-json/wp/v2/posts?per_page=100&page="
	baseUpdateURL = u.String() + "wp-json/wp/v2/posts/"

	for {
		fmt.Printf("Fetching page %d\n", page)
		reqURL := baseURL + fmt.Sprint(page)
		fmt.Printf("Requesting URL: %s\n", reqURL) // print URL being requested

		// Create a new request
		req, err := http.NewRequest("GET", reqURL, nil)
		if err != nil {
			fmt.Printf("Error creating request: %v\n", err)
			return
		}

		// Set the User-Agent to mimic a browser
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3")

		// Send the request
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Printf("Error sending request: %v\n", err)
			break
		}

		fmt.Printf("Response status: %s\n", resp.Status) // print response status
		if resp.StatusCode == http.StatusNotFound {
			fmt.Println("Page not found, stopping.")
			break
		}

		if resp.StatusCode != http.StatusOK {
			fmt.Printf("Unexpected status: %s\n", resp.Status)
			break
		}

		body, _ := ioutil.ReadAll(resp.Body)

		var posts []map[string]interface{}
		json.Unmarshal(body, &posts)

		for _, post := range posts {
			content := post["content"].(map[string]interface{})
			rawHtml := content["rendered"].(string)
			doc, err := html.Parse(strings.NewReader(rawHtml))

			if err != nil {
				fmt.Printf("Error parsing HTML: %v\n", err)
				continue
			}

			fmt.Printf("Checking post %v for broken images\n", int(post["id"].(float64)))

			modified := removeBrokenImages(doc, u)
			newHtml := renderNode(modified)

			if !dryRun {
				fmt.Printf("Updating post %v\n", int(post["id"].(float64)))
				err = updatePost(int(post["id"].(float64)), newHtml)
				if err != nil {
					fmt.Printf("Failed to update post: %v\n", err)
				}
			}
		}

		page++
	}

	fmt.Printf("Checked %d images: %d broken, %d valid\n", validCount+brokenCount, brokenCount, validCount)
}

// removeBrokenImages checks every <img> tag in the HTML document, verifies the image via HTTP GET request.
// If the image is broken (HTTP status >= 400), it removes the <img> tag.
func removeBrokenImages(n *html.Node, u *url.URL) *html.Node {
	if n.Type == html.ElementNode && (n.Data == "img" || n.Data == "IMG") {
		for _, a := range n.Attr {
			if a.Key == "src" {
				imageURL := a.Val
				if strings.HasPrefix(a.Val, "/") {
					imageURL = u.Scheme + "://" + u.Host + a.Val
				}

				resp, err := http.Get(imageURL)
				if err != nil || resp.StatusCode >= 400 {
					fmt.Printf("Found broken image: %s\n", imageURL)
					brokenCount++
					return &html.Node{}
				} else {
					validCount++
				}
			}
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		removeBrokenImages(c, u)
	}

	return n
}

// renderNode converts the HTML node tree back to raw HTML string.
func renderNode(n *html.Node) string {
	var buf bytes.Buffer
	w := io.Writer(&buf)
	html.Render(w, n)
	return buf.String()
}

// updatePost sends a request to the WP REST API to update the post content with the new HTML.
func updatePost(postID int, newHtml string) error {
	reqBody := fmt.Sprintf(`{"content": "%s"}`, newHtml)

	// Then inside the updatePost function, use baseUpdateURL
	req, err := http.NewRequest(http.MethodPut, fmt.Sprintf("%s%d", baseUpdateURL, postID), strings.NewReader(reqBody))
	if err != nil {
		return err
	}
	auth := username + ":" + password
	encodedAuth := base64.StdEncoding.EncodeToString([]byte(auth))
	req.Header.Add("Authorization", "Basic "+encodedAuth)

	req.Header.Add("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %s", resp.Status)
	}

	return nil
}
