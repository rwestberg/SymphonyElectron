#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

properties([
    parameters(withRunConfig([
        string(name: "JENKINS_NODE_LABEL", defaultValue: "syc9-test-win", description: "Label for the jenkins node which the job will run on"),
        string(name: "C9_INTEGRATION_VERSION", defaultValue: "*", description: "The C9 integration version to bundle. Use '*' for the latest version."),
        string(name: "C9_TRADER_INSTALLER", description: "The C9 Trader installer to bundle. Provide a link to the MSI file."),
    ])),

    buildDiscarder(logRotator(artifactNumToKeepStr: '15', numToKeepStr: '15'))
])

abortPreviousRunningBuilds()

node(params.JENKINS_NODE_LABEL) {
    def artifactory = ArtifactoryServer "https://repo.symphony.com/artifactory", "jenkins-artifactory-credentials"

    cleanWs()
    checkout scm

    try {
        stage("Fetch C9-SY-extension") {
            artifactory.download(
                name:   "services/symphony-c9",
                file:   "symphony-c9-${params.C9_INTEGRATION_VERSION}.tgz",
                target: "download/"
            )
        }
        stage("Unpack C9-SY-extension") {
            sh "tar -C download -xzvf download/symphony-c9-*.tgz"
        }
        stage("Fetch C9 Trader installer") {
            sh "curl -L '${params.C9_TRADER_INSTALLER}' -o download/C9Installer.msi"
        }
        stage("Extract C9 Trader") {
            bat "msiexec /a download\\C9Installer.msi /qn TARGETDIR=\"${env.WORKSPACE}\\download\\C9Installer\""
            bat "dir /s download\\C9Installer"
        }
        stage("Move dependencies into place") {
            sh "mkdir -p dist/win-unpacked/cloud9/integration dist/win-unpacked/cloud9/shell"
            sh "mv download/symphony.c9-*/extension.js dist/win-unpacked/cloud9/integration/"
            sh "mv download/C9Installer/ProgramFilesPath/Cloud9\\ Technologies\\ LLC/C9Trader/* dist/win-unpacked/cloud9/shell/"
            sh "rm -rf dist/win-unpacked/cloud9/shell/x86"
            bat "del /s /q dist\\win-unpacked\\cloud9\\shell\\*.pdb"
            bat "dir /s dist\\win-unpacked"
        }
        stage("Package dependencies") {
            bat "powershell Compress-Archive dist\\win-unpacked\\cloud9 syc9-sda-deps.zip"
        }
        stage("Publish dependencies artifact") {
            archiveArtifacts artifacts: 'syc9-sda-deps.zip', fingerprint: false
        }
    } finally {
        cleanWs()
    }
}
