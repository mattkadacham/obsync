# Obsync

A simple Obsidian plugin to sync notes with a github repository.

Setup:

Create a repository with your notes, or start with a blank repo.

Create a [github app](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app#registering-a-github-app) for your repo:
- Go to your user settings
- scroll all the way down the sidebar and select Developer Settings at the bottom
- on the settings page click the New Github App button
- fill out a name, and in the repository settings section, make sure the dropdown for Content is set to Read and Write
- Create the app
- Install the app for your account
- Edit the app, in the General section, under Private Keys, generate a private key, and store in somewhere safe. the Private key is for authenticating the plugin with github.

In the plugin settings, fill in the required fields:

repository owner: username of the repo's owner
repository name: name of the repo
private key: key generated for the github app

Click initialise to pull the latest commit.
