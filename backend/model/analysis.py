import requests
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import folium
from folium import plugins

# ── Step 1: Fetch data ──
url = "https://data.cityofchicago.org/resource/85ca-t3if.json"
all_data = []
limit = 1000
offset = 0

print("Fetching data...")
while True:
    params = {
        "$limit": limit,
        "$offset": offset,
        "$order": "crash_date DESC",
        "$where": "crash_date >= '2018-01-01T00:00:00'"
    }
    response = requests.get(url, params=params)
    data = response.json()
    if len(data) == 0:
        break
    all_data.extend(data)
    offset += limit
    print(f"Fetched {len(all_data)} rows so far...")
    if len(all_data) >= 50000:
        break

df = pd.DataFrame(all_data)
df.to_csv('chicago_crashes.csv', index=False)
print(f"Saved {len(df)} rows!\n")

# ── Step 2: Prepare data ──
df['crash_date'] = pd.to_datetime(df['crash_date'])
df['hour'] = df['crash_date'].dt.hour

# ── Plot 1: Crashes by hour ──
plt.figure(figsize=(15, 8))
sns.set_theme(style='darkgrid')
s = sns.barplot(data=df.groupby('hour')['crash_record_id'].nunique().reset_index(),
                x='hour', y='crash_record_id', palette='GnBu_r', linewidth=0)
s.set_title('Hourly Number of Reported Crashes in Chicago (Live Data)', y=1.02, fontsize=14)
s.set_xlabel('Hour of Day', fontsize=13, labelpad=15)
s.set_ylabel('Number of Crashes', fontsize=13, labelpad=15)
plt.show()

# ── Plot 2: Primary contributing causes ──
plt.figure(figsize=(15, 15))
sns.countplot(data=df, y='prim_contributory_cause',
              order=df['prim_contributory_cause'].value_counts().index)
plt.title('Primary Contributing Cause of Crashes (Live Data)', y=1.01, fontsize=14)
plt.xlabel('Number of Crashes', fontsize=13, labelpad=15)
plt.ylabel('Primary Contributing Cause', fontsize=13, labelpad=15)
plt.show()

# ── Plot 3: Lighting conditions ──
plt.figure(figsize=(12, 6))
sns.countplot(data=df, y='lighting_condition',
              order=df['lighting_condition'].value_counts().index)
plt.title('Crashes by Lighting Condition (Live Data)', y=1.01, fontsize=14)
plt.xlabel('Number of Crashes', fontsize=13, labelpad=15)
plt.ylabel('Lighting Condition', fontsize=13, labelpad=15)
plt.show()

# ── Map: Hit and run cluster map ──
df_hitrun = df[df['hit_and_run_i'] == 'Y']
df_hitrun = df_hitrun[df_hitrun['longitude'].notna()]
m = folium.Map(location=[41.8781, -87.6798], zoom_start=12)
hitrun = plugins.MarkerCluster().add_to(m)
for lat, lng in zip(df_hitrun['latitude'], df_hitrun['longitude']):
    folium.Marker(location=[lat, lng], icon=None).add_to(hitrun)
m.save('hitrun_map.html')
print(f"Map saved! Total hit and run crashes: {len(df_hitrun)}")

