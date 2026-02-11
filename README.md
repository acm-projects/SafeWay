
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
<summary>  <strong> Week 3/4: Coding ⚙️ </strong> </summary>
<br>
  
- Frontend:
  - Login/Sign Up Pages
  - Home Page
  - Integrate the colored lines to the Frontend
- Backend:
  - Ingest historical crime CSV into the Database (spatially join to nearest streets)
  - Write a script to calculate a Base_Risk_Score (0-10) for every street segment
  - Create groups, Join groups
  - Create an API endpoint GET /risk_map that returns colored lines
 
- Milestone: The phone map displays streets colored by their historical safety score.

</details>

