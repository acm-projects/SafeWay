
<p align="center">
  <img src="https://64.media.tumblr.com/49820614ba3e70ef30116f9d7168260f/tumblr_ntlh02HEUB1tbvr3po1_400.gifv" alt="animated" />
</p>


<h1 align="center"> SafeWay 🗺️ </h1>

<div align="center">SafeWay is a safety-focused navigation app that calculates walking/driving routes based on crime data, street lighting, and environmental factors rather than just distance. Unlike standard maps that optimize for speed, SafeStep empowers users to choose their own balance between efficiency and safety using dynamic risk weighting and predictive machine learning.</div>

## MVP 🏆
- Map Interface
- Search
- Visual Routing
- Location Tracking
- Historial Data Collection
- Edge Weight Algorithm
- User Controls / Preferences

## Stretch Goals 🌟
- Predictive Layer (ML)
- Live Data Scraper (Automation + NLP)
- Contextual APIs
- Client Side Server (model)
- Future Implementation: Travel Planner (Traveling Salesman)

## Milestones ☀️
<details closed>
<summary>  <strong> Week 1: Setup 🌅 </strong> </summary>
<br>
  
- Decide frontend/backend teams
- Finalize tech stack
- Research/Learn Tech Stack
  - Understand Kaggle DataSet (Crime Data)
- Environment Setup
  - Set up React Native (Expo) project on the phone.
  - Set up FastAPI "Hello World" server on the laptop.
- Learn Git/Github
- Begin App Design with Figma


</details>

<details closed>
<summary>  <strong> Week 2: Ramp-Up 💡 </strong> </summary>
<br>
  
- Frontend:
  - Finish Figma Design and Prototype by the end of week
  - Learn React Native
    - Implement react-native-maps to show the user's current location (Blue Dot).
- Backend:
  - Start looking into the API’s
  - Set up User Authentication
  - Set up Database
    - Install PostgreSQL & PostGIS extension.
    - Use OSMnx to download a small map chunk (e.g., Campus area) and save nodes/edges to DB.

- Milestone: You can see the map on the phone and query street data in SQL
  
</details>

<details closed>
<summary>  <strong> Week 3: Coding ⚙️ </strong> </summary>
<br>
  
- Frontend:
  - Login/Sign Up Pages
  - Home Page
  - Fetch and display a static list of coordinates (Polyline) from the backend
  - Color-code the line (Green/Red) based on a dummy "risk score" sent by the server.
  - Deliverable: A colored line appears on the map.
- Backend:
  - Ingest historical crime CSV into the Database (spatially join to nearest streets)
  - Write a script to calculate a Base_Risk_Score (0-10) for every street segment
  - Create groups, Join groups
  - Create an API endpoint GET /risk_map that returns colored lines
  - Deliverable: API returns JSON with street segments and scores.
 
- Milestone: The phone map displays streets colored by their historical safety score.

</details>

<details closed>
<summary>  <strong> Week 4: More Coding ⚙️ </strong> </summary>
<br>
  
- Frontend:
  - Add text input for "Destination."
  - Implement Geocoding (convert "Library" to lat/long) using a free API (example: Nominatim)
  - Deliverable: User types a place, map pins it
- Backend:
  - Build the Graph in NetworkX
  - Implement the Cost Function. (example: Cost = Length + (Risk * Weight))
  - Write search algorithm logic. (Dijkstra’s Algorithm or A* Search)
  - Deliverable: Script prints "Safe Path" nodes between two points.

</details>

<details closed>
<summary>  <strong> Week 5/6: Middle Stretch 💫 </strong> </summary>
<br>
  
- Integrate backend features with finished frontend pages (User Auth)
- Frontend
  - Navigation Controls: 
    - Send start and end coordinates to the backend.
    - Receive the route_geometry array
    - Draw the specific path on the map
    - Deliverable: "Get Route" button draws the calculated path.
  - User Controls:
    - Add "Safety vs. Speed" Slider (0.0 - 1.0)
    - Pass slider value to the backend API.
    - Deliverable: Moving slider refreshes the route line.
- Backend
   - The Routing API:
    - Create endpoint POST /get_route
    - Accept start, end, and safety_preference
    - Return the calculated path as GeoJSON.
    - Deliverable: API returns the optimal path coordinates
  - Dynamic Weighting:
    - Update routing logic to use the safety_preference multiplier.
    - Tuning: Adjust math so the route actually changes when slider moves.
    - Deliverable: API returns different paths for Safety=0 vs Safety=1.

</details>

<details closed>
<summary>  <strong> Week 7: Almost There ⏳ </strong> </summary>
<br>
  
- Integrate finished backend features with finished frontend pages
- Finish all MVP features
- Work on stretch goals if possible
- Frontend
  - Implement "Camera Follow" mode (map centers on user)
  - Add "Step-by-Step" text box ("Turn left on Main St")
  - Deliverable: App feels like a real GPS 
- Backend
  - Generate text instructions from the route ("Head North")
  - Send instructions along with geometry
  - Deliverable: API returns readable steps.

</details>

<details closed>
<summary>  <strong> Week 8: Wrapping Up 🌙 </strong> </summary>
<br>
  
- Finish backend/frontend integration
- Add finishing touches
- Finish stretch goals if possible
- Begin work on presentation 

</details>

<details closed>
<summary>  <strong> Week 9/10: Presentation Prep 🎬 </strong> </summary>
<br>
  
- Prep for Presentation Night
- Finish Slides + Script + Demo

</details>

## Tech Stack 💻

<strong> IDE: </strong> VSCode                                                                        
<strong> Emulator: </strong> Expo or XCode                                                
<strong> Wireframe: </strong> Figma

<strong> 1st Choice Stack: </strong> 
- Mobile App (Frontend): React Native (via Expo)
- Map Interface: react-native-maps
- Backend API: FastAPI (Python)
- Database: PostgreSQL + PostGIS (Supabase)
- Routing Engine: NetworkX (Python)
- Data Processing: Pandas & GeoPandas
- Machine Learning: Scikit-Learn
- Map Data Source: OSMnx

## Helpful Resources/Tutorials 🔎

 <strong> React Native: </strong>
- [React Native Basics](https://reactnative.dev/docs/tutorial?language=javascript)
- [Environment Setup](https://reactnative.dev/docs/environment-setup)
- [Environment Setup with Expo](https://docs.expo.dev/router/installation/)
- [Build Full Stack App in React Native](https://www.youtube.com/watch?v=eYByUtXQbEo)
- [React Native Course](https://www.youtube.com/watch?v=ZBCUegTZF7M&t=1396s)
- [React Native Tutorial](https://www.youtube.com/watch?v=6ZnfsJ6mM5c)

<strong> XCode: </strong>
- [Install IOS Simulator](https://www.youtube.com/watch?v=Ws-wnDywtMI)

<strong> FastAPI: </strong>
- [Installing FastAPI (make sure to understand virtual environments](https://fastapi.tiangolo.com/#installation)

<strong> APIs: </strong>
- [Fetching Data from an API in React Native](https://www.youtube.com/watch?v=KJhg761xb3c)
- [React Native Tutorial - POST Request](https://www.youtube.com/watch?v=BecN2PxyR_0)
- [React Native tutorial - API Call](https://www.youtube.com/watch?v=NuKQk7nbk0k) 
- [Google Calendar API with Node.js](https://www.youtube.com/watch?v=2byT7fYT8UE)
- [Postman Tutorial](https://www.youtube.com/watch?v=MFxk5BZulVU)
- [RapidAPI](https://rapidapi.com/search/restaurants)
- [Google Cloud Natural Language API](https://cloud.google.com/natural-language)

<strong> Other Technologies for Finding Free Time Slots: </strong>
- [GraphQL Course for Beginners](https://www.youtube.com/watch?v=5199E50O7SI)
- [GraphQL With React Tutorial - Apollo Client](https://www.youtube.com/watch?v=YyUWW04HwKY)
- [date-fns](https://www.youtube.com/watch?v=9YZIQAmgD0o)
- [AWS Lambda](https://www.youtube.com/watch?v=UsaiOEFdfs0)
- [Associating a Lambda function to your Amazon Lex v2 bot](https://www.youtube.com/watch?v=57ZqpzHtQX4) 
- [Amazon Lex: Validate Slot data with Lambda](https://www.youtube.com/watch?v=1xRl8Ipa018)

<strong> Optional/Stretch Goals: </strong>
- [Amazon Kendra: Search Calendars](https://www.youtube.com/watch?v=Yo9YQCGG5zM)
- [Amazon Lex: Voice Activated Scheduling](https://www.youtube.com/watch?v=3AZ1n2oHtEI)

Git Cheat Sheets:      
- [Git Cheat Sheet 1](https://education.github.com/git-cheat-sheet-education.pdf)                                                                                                                                                
- [Git Cheat Sheet 2](https://drive.google.com/file/d/1OddwoSvNJ3dQuEBw3RERieMXmOicif9_/view)  

Resources for Design:    
- [Best App Design](https://dribbble.com/tags/best-app-design) - copy and paste link if it takes you to forbidden                                                                                                                 
- [Dribble](https://dribbble.com/)  - copy and paste link if it takes you to forbidden                                                                                                                                            
- [Color Palettes](https://www.canva.com/colors/color-palettes/)                                                                                                                                                                  
- [More Color Palettes](https://colorhunt.co/)                                                                                                                                                                                    
- [Do's and Don'ts of Mobile App Design](https://realmonkey.co/mobile-app-design/the-dos-and-donts-of-mobile-app-design/)



Other Resources:           
- [Git Tutorial](https://www.youtube.com/watch?v=USjZcfj8yxE)  
- [Figma](https://www.figma.com/files/project/81846282/Team-project?fuid=1155168864304822849)                                                                                              
- [How to be Successful in Projects](https://docs.google.com/document/d/18Zi3DrKG5e6g5Bojr8iqxIu6VIGl86YBSFlsnJnlM88/edit)

## GitHub Cheat Sheet ⚡️

General Use

| Command | Description |
| ------ | ------ |
| cd "SafeWay" | Change directories over to our repository |
| git branch | Lists branches for you |
| git branch "branch name" | Makes new branch |
| git checkout "branch name" | Switch to branch |
| git checkout -b "branch name" | Same as 2 previous commands together |
| git add . | Finds all changed files |
| git commit -m "Testing123" | Commit with message |
| git push origin "branch" | Push to branch |
| git pull origin "branch" | Pull updates from a specific branch |

## Project Manager
- Mathew Biji

## Industry Mentor
- Thilak Jayachandran

## Developers‼️‼️ 
