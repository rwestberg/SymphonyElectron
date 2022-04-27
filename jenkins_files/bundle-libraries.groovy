#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

properties([
    parameters(withRunConfig([
        string(name: "JENKINS_NODE_LABEL", defaultValue: "syc9-test-win", description: "Label for the jenkins node which the job will run on"),
        string(name: "SDA_INSTALLER", description: "The standard Symphony Desktop Application installer to extract libraries from. Provide a link to the MSI file."),
    ])),

    buildDiscarder(logRotator(artifactNumToKeepStr: '15', numToKeepStr: '15'))
])

abortPreviousRunningBuilds()

node(params.JENKINS_NODE_LABEL) {
    def artifactory = ArtifactoryServer "https://repo.symphony.com/artifactory", "jenkins-artifactory-credentials"

    cleanWs()
    checkout scm

    try {
        stage("Fetch base SDA installer") {
            sh "curl -L '${params.SDA_INSTALLER}' -o SDAInstaller.msi"
        }
        stage("Extract base SDA") {
            bat "msiexec /a SDAInstaller.msi /qn TARGETDIR=\"${env.WORKSPACE}\\SDAInstaller\""
            bat "dir /s SDAInstaller"
        }
        stage("Package libraries") {
            bat "powershell Compress-Archive SDAInstaller/ProgramFiles64Folder/Symphony/library syc9-sda-libraries.zip"
        }
        stage("Publish dependencies artifact") {
            archiveArtifacts artifacts: 'syc9-sda-libraries.zip', fingerprint: false
        }
    } finally {
        cleanWs()
    }
}
