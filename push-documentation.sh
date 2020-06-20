cd "$(dirname ${BASH_SOURCE[0]})"

VERSION="$(git rev-parse --short HEAD)"
MESSAGE="$(git show --no-patch --format=%s HEAD)"

rm -rf dist documentation
npm run build -- --base-href /ngx-chat-ghpages/
npm run documentation
cp -r documentation dist/chat-conference-plugin/
cd dist/chat-conference-plugin
git init .
git remote add origin git@github.com:proxym/ngx-chat-ghpages.git
git fetch
git reset --soft origin/master
git add .
git commit -m "$MESSAGE ($VERSION)"
git push origin master
