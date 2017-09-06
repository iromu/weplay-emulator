pipeline {
    agent any

    triggers {
      upstream(upstreamProjects: "weplay-common/" + env.BRANCH_NAME.replaceAll("/", "%2F"), threshold: hudson.model.Result.SUCCESS)
    }
    stages  {

        stage('Initialize') {
          steps {
            script {
              def node = tool name: 'Node-8.4.0', type: 'jenkins.plugins.nodejs.tools.NodeJSInstallation'
              env.PATH = "${node}/bin:${env.PATH}"
            }
            sh 'node -v'
            sh 'sudo apt-get install -y libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential g++'
            sh 'yarn install'
          }
        }
apt-get install -y libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential g++
       stage('Build'){
         steps {
            sh 'yarn build'
         }
       }

       stage('Archive'){
         steps {
            sh 'yarn pack'
            archiveArtifacts '*.tgz'
            publishHTML([allowMissing: false, alwaysLinkToLastBuild: false, keepAll: true, reportDir: 'report/plato', reportFiles: 'index.html', reportName: 'Plato Report', reportTitles: ''])
         }
       }

       stage('Cleanup'){
         steps {
            cleanWs()
         }
       }

    }
}
