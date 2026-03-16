---
id: thr_d4e5f6
title: Home Automation
type: project
tags: [iot, home-assistant, automation, local-first]
created: 2026-03-05T19:00:00Z
modified: 2026-03-12T21:30:00Z
author: user
source: manual
links:
  - local-first-software
  - bob-kumar
status: active
history:
  - action: created
    by: user
    at: 2026-03-05T19:00:00Z
    reason: "Started documenting home automation setup and plans"
  - action: edited
    by: user
    at: 2026-03-12T21:30:00Z
    reason: "Added sensor network section after weekend tinkering"
---

# Home Automation

Personal project to build a privacy-respecting, [[local-first-software]] home automation system. No cloud dependencies, no subscriptions, full ownership of data.

## Principles

- Everything runs locally on a Raspberry Pi cluster
- No vendor lock-in: use open protocols (Zigbee, Z-Wave, MQTT)
- All automations must be version-controlled and auditable
- The system should degrade gracefully when components fail

## Current Setup

- **Hub**: Home Assistant on a Pi 4 with an SSD
- **Lighting**: Zigbee bulbs and switches via a Conbee II stick
- **Climate**: Ecobee thermostats with local API integration
- **Security**: Frigate NVR with Coral TPU for local object detection

## Sensor Network

Working on deploying ESP32-based environmental sensors throughout the house. Each sensor reports temperature, humidity, light level, and air quality over MQTT. [[bob-kumar]] recommended the BME680 sensor for air quality — it measures VOCs and gives a composite IAQ index.

## Planned Automations

- Circadian lighting that adjusts color temperature throughout the day
- Presence-based HVAC zones using mmWave radar sensors
- Automated garden irrigation based on soil moisture and weather forecasts
- Energy monitoring dashboard with anomaly detection

## Integration Ideas

Eventually I want to connect this with Loom. Imagine daily notes that automatically include a summary of home events: energy usage, unusual sensor readings, automation triggers. The [[loom-knowledge-graph]] could treat sensor data as a knowledge source.

## References

- [Home Assistant docs](https://www.home-assistant.io/docs/)
- [ESPHome](https://esphome.io/)
- [Frigate NVR](https://frigate.video/)
